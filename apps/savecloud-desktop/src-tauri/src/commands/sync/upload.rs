//! Módulo de subida de archivos de guardado a almacenamiento remoto.
//!
//! Este módulo implementa la lógica de transferencia de archivos,
//! seleccionando automáticamente la estrategia de subida en función
//! del tamaño del archivo:
//!
//! - Subida simple para archivos pequeños.
//! - Subida multipart para archivos grandes.
//!
//! Además, expone mecanismos para el seguimiento del progreso y la
//! notificación del resultado de cada operación.
//!
//! # Fiabilidad
//!
//! Para mejorar la resiliencia ante fallos de red o backend:
//!
//! - Se utilizan URLs prefirmadas generadas en lote para minimizar
//!   la cantidad de solicitudes al backend.
//! - Se aplican reintentos con backoff en operaciones críticas.
//! - Se configuran timeouts a nivel de conexión y de request en el cliente HTTP.
use super::api;
use super::events::{
    emit_sync_terminal, emit_sync_upload_done, emit_sync_upload_paused, emit_sync_upload_progress,
    sync_status_from_err_count, sync_status_from_result,
};
use super::models::{GameSyncResultDto, SyncOperationStrategy, SyncProgressPayload, SyncResultDto};
use super::multipart_upload;
use crate::network::DATA_CLIENT;
use crate::tray::tray_state::TrayState;
use crate::utils::path_utils;
use bytes::Bytes;
use futures_util::stream::{self, Stream, StreamExt};
use std::collections::HashMap;
use std::fs;
use std::io::{BufReader, Read};
use tauri::{AppHandle, Manager, State};
use tokio::sync::mpsc;

/// Emitir progreso cada N bytes para no saturar el frontend (usado por `file_stream_with_progress`).
#[allow(dead_code)]
const PROGRESS_CHUNK_BYTES: usize = 256 * 1024;

/// Cuántos PUTs simples se ejecutan en paralelo.
const SIMPLE_PUT_CONCURRENCY: usize = 24;

/// Umbrales para prohibir subida archivo a archivo. Por encima de estos valores
/// el usuario debe usar "Empaquetar y subir" obligatoriamente.
const LARGE_GAME_BLOCK_FILE_COUNT: usize = 200;
const LARGE_GAME_BLOCK_SIZE_BYTES: u64 = 200 * 1024 * 1024; // 200 MB

/// Stream que recibe chunks de un canal (llenado por un hilo que lee el archivo).
#[allow(dead_code)]
struct FileProgressStream {
    rx: mpsc::Receiver<Result<Bytes, std::io::Error>>,
}

impl Stream for FileProgressStream {
    type Item = Result<Bytes, std::io::Error>;

    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx)
    }
}

/// Crea un stream que lee el archivo en chunks y emite progreso. El stream se consume al hacer el PUT.
#[allow(dead_code)]
fn file_stream_with_progress(
    absolute: &std::path::Path,
    total: u64,
    app: AppHandle,
    game_id: String,
    filename: String,
) -> Result<FileProgressStream, String> {
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(2);
    let absolute = absolute.to_path_buf();

    std::thread::spawn(move || {
        let file = match fs::File::open(&absolute) {
            Ok(f) => f,
            Err(e) => {
                let _ = tx.blocking_send(Err(e));
                return;
            }
        };

        let mut reader = BufReader::with_capacity(PROGRESS_CHUNK_BYTES, file);
        let mut loaded: u64 = 0;
        let mut last_emit: u64 = 0;
        let mut buf = vec![0u8; PROGRESS_CHUNK_BYTES];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    loaded += n as u64;
                    if loaded - last_emit >= PROGRESS_CHUNK_BYTES as u64
                        || (total > 0 && loaded >= total)
                    {
                        last_emit = loaded;
                        emit_sync_upload_progress(
                            &app,
                            SyncProgressPayload {
                                operation_id: Some(format!("sync-upload-{}", game_id)),
                                status: Some("running".to_string()),
                                game_id: game_id.clone(),
                                filename: filename.clone(),
                                loaded,
                                total,
                                downloaded_bytes: Some(loaded),
                                total_bytes: Some(total),
                                can_pause: None,
                                can_cancel: None,
                                can_resume: None,
                                strategy: Some(SyncOperationStrategy::Simple),
                                state: None,
                                reason_code: None,
                            },
                        );
                    }

                    let chunk = Bytes::from(buf[..n].to_vec());
                    if tx.blocking_send(Ok(chunk)).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    break;
                }
            }
        }

        if loaded > 0 && loaded < total {
            emit_sync_upload_progress(
                &app,
                SyncProgressPayload {
                    operation_id: Some(format!("sync-upload-{}", game_id)),
                    status: Some("running".to_string()),
                    game_id,
                    filename,
                    loaded: total,
                    total,
                    downloaded_bytes: Some(total),
                    total_bytes: Some(total),
                    can_pause: None,
                    can_cancel: None,
                    can_resume: None,
                    strategy: Some(SyncOperationStrategy::Simple),
                    state: None,
                    reason_code: None,
                },
            );
        }
    });
    Ok(FileProgressStream { rx })
}

/// Solicita cancelar la subida en curso (solo tiene efecto en subidas multipart entre partes).
#[tauri::command]
pub fn request_upload_cancel(tray_state: State<'_, TrayState>) {
    tray_state.0.request_upload_cancel();
}

/// Solicita pausar la subida en curso. Se guarda el estado en disco y se puede reanudar con sync_upload_resume.
#[tauri::command]
pub fn request_upload_pause(tray_state: State<'_, TrayState>) {
    tray_state.0.request_upload_pause();
}

/// Devuelve la info de la subida pausada, si existe (para mostrar "Reanudar" en la UI).
#[tauri::command]
pub fn get_paused_upload_info() -> Option<PausedUploadInfoDto> {
    multipart_upload::load_paused_state().map(|s| PausedUploadInfoDto {
        game_id: s.game_id,
        filename: s.filename,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedUploadInfoDto {
    pub game_id: String,
    pub filename: String,
}

/// Reanuda la subida multipart guardada (tras pausar). Solo hay una subida pausada a la vez.
#[tauri::command]
pub async fn sync_upload_resume(app: AppHandle) -> Result<SyncResultDto, String> {
    let tray_state = app.state::<TrayState>();
    tray_state.0.reset_upload_cancel();
    tray_state.0.reset_upload_pause();
    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();

    let result = multipart_upload::resume_paused_upload(app.clone()).await;

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();
    let op_id = load_paused_operation_id();
    let status = sync_status_from_result(&result);
    emit_sync_terminal(&app, op_id, status, "upload", None, None, None);
    emit_sync_upload_done(&app);

    result.map(|()| SyncResultDto {
        ok_count: 1,
        err_count: 0,
        errors: vec![],
    })
}

#[tauri::command]
pub async fn sync_upload_game(
    game_id: String,
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<SyncResultDto, String> {
    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();
    tray_state.0.clear_restore_cooldown(&game_id);

    tray_state.0.reset_upload_cancel();
    tray_state.0.reset_upload_pause();
    let operation_id = format!("sync-upload-{}", game_id);
    let result =
        sync_upload_game_impl(game_id.clone(), app.clone(), Some(tray_state.0.clone())).await;

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();

    let cancelled = tray_state.0.upload_cancel_requested();
    let status = if cancelled {
        "cancelled"
    } else {
        sync_status_from_result(&result)
    };
    let reason_code = if cancelled {
        Some("CANCELLED_BY_USER".to_string())
    } else {
        None
    };
    emit_sync_terminal(
        &app,
        operation_id,
        status,
        "upload",
        Some(game_id),
        None,
        reason_code,
    );
    emit_sync_upload_done(&app);
    result
}

pub(crate) async fn sync_upload_game_impl(
    game_id: String,
    app: AppHandle,
    tray_inner: Option<std::sync::Arc<crate::tray::tray_state::TrayStateInner>>,
) -> Result<SyncResultDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    if crate::system::process_check::is_game_running(&game_id, &game.paths) {
        return Err(format!(
            "El juego está en ejecución. Cierra {} antes de sincronizar para evitar archivos bloqueados.",
            game.id
        ));
    }

    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    let files = path_utils::list_all_files_from_paths(&game.paths);
    if files.is_empty() {
        return Ok(SyncResultDto {
            ok_count: 0,
            err_count: 0,
            errors: vec!["No se encontraron archivos en las rutas del juego".into()],
        });
    }

    let files_with_size: Vec<((String, String), u64)> = files
        .iter()
        .map(|(abs, rel)| {
            let size = fs::metadata(abs)
                .map_err(|e| format!("{}: {}", rel, e))
                .map(|m| m.len())?;
            Ok(((abs.clone(), rel.clone()), size))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let file_count = files_with_size.len();
    let total_size: u64 = files_with_size.iter().map(|(_, s)| s).sum();

    if file_count >= LARGE_GAME_BLOCK_FILE_COUNT || total_size >= LARGE_GAME_BLOCK_SIZE_BYTES {
        return Err(format!(
            "Este juego es demasiado grande para subir archivo a archivo ({} archivos, {} MB). Usa \"Empaquetar y subir\" desde el menú del juego.",
            file_count,
            total_size / (1024 * 1024)
        ));
    }

    let (multipart_files, simple_files): (Vec<_>, Vec<_>) = files_with_size
        .into_iter()
        .partition(|(_, size)| *size >= multipart_upload::MULTIPART_THRESHOLD);

    let mut ok_count = 0u32;
    let mut err_count = 0u32;
    let mut errors = Vec::new();
    let mut loaded_bytes_total: u64 = 0;

    emit_sync_upload_progress(
        &app,
        SyncProgressPayload {
            operation_id: Some(format!("sync-upload-{}", game_id)),
            status: Some("running".to_string()),
            game_id: game_id.clone(),
            filename: "Preparando subida…".to_string(),
            loaded: 0,
            total: total_size,
            downloaded_bytes: Some(0),
            total_bytes: Some(total_size),
            can_pause: None,
            can_cancel: None,
            can_resume: None,
            strategy: None,
            state: None,
            reason_code: None,
        },
    );

    for ((absolute, relative), total) in multipart_files {
        if let Some(ref t) = tray_inner {
            if t.upload_pause_requested() || t.upload_cancel_requested() {
                break;
            }
        }

        match multipart_upload::upload_one_file_multipart(
            std::path::Path::new(&absolute),
            &relative,
            total,
            &game_id,
            api_base,
            user_id,
            api_key,
            app.clone(),
            tray_inner.clone(),
        )
        .await
        {
            Ok(()) => {
                ok_count += 1;
                loaded_bytes_total = loaded_bytes_total.saturating_add(total);
                let now = filetime::FileTime::from_system_time(std::time::SystemTime::now());
                let _ = filetime::set_file_mtime(std::path::Path::new(&absolute), now);
            }
            Err(e) => {
                if e == multipart_upload::PAUSED_ERR_MSG {
                    emit_sync_upload_paused(&app, &game_id, &relative);
                    break;
                } else {
                    crate::commands::logs::sync_logger::log_error(
                        "upload_multipart",
                        &crate::commands::logs::sync_logger::upload_context(
                            &game_id, &relative, &absolute,
                        ),
                        &e,
                    );
                    errors.push(format!("{}: {}", relative, e));
                    err_count += 1;
                }
            }
        }
    }

    if let Some(ref t) = tray_inner {
        if t.upload_pause_requested() || t.upload_cancel_requested() {
            let result = SyncResultDto {
                ok_count,
                err_count,
                errors,
            };
            let _ = crate::config::append_operation_log(
                "upload",
                &game_id,
                result.ok_count,
                result.err_count,
            );
            return Ok(result);
        }
    }

    const UPLOAD_URLS_BATCH_SIZE: usize = 500;
    if !simple_files.is_empty() {
        let total_simple = simple_files.len();
        crate::commands::logs::sync_logger::log_operation(
            "upload_simple_batch",
            &format!("gameId={} file_count={}", game_id, total_simple),
        );

        let filenames: Vec<String> = simple_files.iter().map(|((_, r), _)| r.clone()).collect();
        let mut upload_urls = Vec::with_capacity(filenames.len());

        for chunk in filenames.chunks(UPLOAD_URLS_BATCH_SIZE) {
            let batch = api::get_upload_urls(api_base, user_id, api_key, &game_id, chunk)
                .await
                .map_err(|e| {
                    crate::commands::logs::sync_logger::log_error(
                        "upload_urls",
                        &format!("gameId={}", game_id),
                        &e,
                    );
                    format!("upload-urls: {}", e)
                })?;
            upload_urls.extend(batch);
        }

        if upload_urls.len() != total_simple {
            return Err(format!(
                "API devolvió {} URLs para {} archivos",
                upload_urls.len(),
                total_simple
            ));
        }

        crate::commands::logs::sync_logger::log_operation(
            "upload_simple_urls_ok",
            &format!("gameId={} total={}", game_id, total_simple),
        );

        let items: Vec<_> = simple_files
            .into_iter()
            .zip(upload_urls)
            .map(|(((abs, rel), total), (url, _))| (abs, rel, total, url))
            .collect();

        let mut put_count: usize = 0;
        let mut stream = stream::iter(items)
            .map(|(absolute, relative, total, upload_url)| async move {
                let body = match tokio::fs::read(&absolute).await {
                    Ok(b) => b,
                    Err(e) => {
                        return Err((
                            relative.clone(),
                            absolute,
                            total,
                            format!("{}: {}", relative, e),
                        ))
                    }
                };

                let put_res = match DATA_CLIENT
                    .put(&upload_url)
                    .body(body)
                    .header("Content-Type", "application/octet-stream")
                    .header("Content-Length", total.to_string())
                    .send()
                    .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        return Err((
                            relative.clone(),
                            absolute,
                            total,
                            format!("{}: {}", relative, e),
                        ))
                    }
                };

                if put_res.status().is_success() {
                    let now = filetime::FileTime::from_system_time(std::time::SystemTime::now());
                    let _ = filetime::set_file_mtime(std::path::Path::new(&absolute), now);
                    Ok((relative, total))
                } else {
                    let msg = format!("{}: S3 PUT {}", relative, put_res.status());
                    Err((relative, absolute, total, msg))
                }
            })
            .buffer_unordered(SIMPLE_PUT_CONCURRENCY);

        while let Some(result) = stream.next().await {
            if let Some(ref t) = tray_inner {
                if t.upload_pause_requested() || t.upload_cancel_requested() {
                    break;
                }
            }

            put_count += 1;
            if put_count % 500 == 0 {
                crate::commands::logs::sync_logger::log_operation(
                    "upload_simple_progress",
                    &format!("gameId={} done={}/{}", game_id, put_count, total_simple),
                );
            }

            match result {
                Ok((relative, uploaded_bytes)) => {
                    ok_count += 1;
                    loaded_bytes_total = loaded_bytes_total.saturating_add(uploaded_bytes);
                    emit_sync_upload_progress(
                        &app,
                        SyncProgressPayload {
                            operation_id: Some(format!("sync-upload-{}", game_id)),
                            status: Some("running".to_string()),
                            game_id: game_id.clone(),
                            filename: relative,
                            loaded: loaded_bytes_total.min(total_size),
                            total: total_size,
                            downloaded_bytes: Some(loaded_bytes_total.min(total_size)),
                            total_bytes: Some(total_size),
                            can_pause: None,
                            can_cancel: None,
                            can_resume: None,
                            strategy: Some(SyncOperationStrategy::Simple),
                            state: None,
                            reason_code: None,
                        },
                    );
                }
                Err((relative, absolute, _uploaded_bytes, err_msg)) => {
                    crate::commands::logs::sync_logger::log_error(
                        "upload_put",
                        &crate::commands::logs::sync_logger::upload_context(
                            game_id.as_str(),
                            &relative,
                            &absolute,
                        ),
                        &err_msg,
                    );
                    errors.push(err_msg);
                    err_count += 1;
                }
            }
        }

        crate::commands::logs::sync_logger::log_operation(
            "upload_simple_done",
            &format!("gameId={} files={}", game_id, total_simple),
        );
    }

    let result = SyncResultDto {
        ok_count,
        err_count,
        errors,
    };

    let _ =
        crate::config::append_operation_log("upload", &game_id, result.ok_count, result.err_count);

    Ok(result)
}

/// Número de juegos que se suben en paralelo en "subir todos".
const UPLOAD_BATCH_CONCURRENCY: usize = 4;

/// Sube los guardados de todos los juegos configurados (operación batch, varios juegos en paralelo).
#[tauri::command]
pub async fn sync_upload_all_games(
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<Vec<GameSyncResultDto>, String> {
    let cfg = crate::config::load_config();
    let _ = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let _ = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;

    tray_state.0.syncing_inc();
    tray_state.0.reset_upload_cancel();
    tray_state.0.reset_upload_pause();
    tray_state.0.update_tooltip();

    let mut results_by_id: HashMap<String, GameSyncResultDto> = HashMap::new();

    for game in &cfg.games {
        if crate::system::process_check::is_game_running(&game.id, &game.paths) {
            let game_id = game.id.clone();
            results_by_id.insert(
                game_id.clone(),
                GameSyncResultDto {
                    game_id,
                    result: SyncResultDto {
                        ok_count: 0,
                        err_count: 1,
                        errors: vec![format!(
                            "{} está en ejecución. Ciérralo antes de sincronizar.",
                            game.id
                        )],
                    },
                },
            );
        }
    }

    let to_sync: Vec<String> = cfg
        .games
        .iter()
        .filter(|g| !results_by_id.contains_key(&g.id))
        .map(|g| g.id.clone())
        .collect();

    for game_id in &to_sync {
        tray_state.0.clear_restore_cooldown(game_id);
    }

    let tray_inner = Some(tray_state.0.clone());
    let completed: Vec<(String, Result<SyncResultDto, String>)> = stream::iter(to_sync)
        .map(|game_id| {
            let app = app.clone();
            let inner = tray_inner.clone();
            async move {
                let r = sync_upload_game_impl(game_id.clone(), app, inner).await;
                (game_id, r)
            }
        })
        .buffer_unordered(UPLOAD_BATCH_CONCURRENCY)
        .collect()
        .await;

    for (game_id, r) in completed {
        let result = match r {
            Ok(x) => x,
            Err(e) => SyncResultDto {
                ok_count: 0,
                err_count: 1,
                errors: vec![e],
            },
        };
        results_by_id.insert(game_id.clone(), GameSyncResultDto { game_id, result });
    }

    let cancelled = tray_state.0.upload_cancel_requested();
    for dto in results_by_id.values() {
        let status = if cancelled {
            "cancelled"
        } else {
            sync_status_from_err_count(dto.result.err_count)
        };
        emit_sync_terminal(
            &app,
            format!("sync-upload-{}", dto.game_id),
            status,
            "upload",
            Some(dto.game_id.clone()),
            None,
            if cancelled {
                Some("CANCELLED_BY_USER".to_string())
            } else {
                None
            },
        );
    }

    let results: Vec<GameSyncResultDto> = cfg
        .games
        .iter()
        .map(|g| results_by_id.get(&g.id).cloned().expect("result per game"))
        .collect();

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();

    emit_sync_upload_done(&app);

    Ok(results)
}

fn load_paused_operation_id() -> String {
    multipart_upload::load_paused_state()
        .map(|s| format!("sync-upload-{}", s.game_id))
        .unwrap_or_else(|| "sync-upload-resume".to_string())
}
