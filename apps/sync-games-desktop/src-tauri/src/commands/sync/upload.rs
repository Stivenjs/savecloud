//! Subida de guardados a la nube.

use std::collections::HashMap;
use std::fs;
use std::io::Read;

use super::api;
use super::models::{GameSyncResultDto, SyncProgressPayload, SyncResultDto};
use super::multipart_upload;
use super::path_utils;
use crate::tray_state::TrayState;
use bytes::Bytes;
use futures_util::stream::{self, Stream, StreamExt};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;

/// Emitir progreso cada N bytes para no saturar el frontend (usado por `file_stream_with_progress`).
#[allow(dead_code)]
const PROGRESS_CHUNK_BYTES: usize = 256 * 1024;

/// Cuántos PUTs simples se ejecutan en paralelo (acelera mucho cuando hay miles de archivos).
const SIMPLE_PUT_CONCURRENCY: usize = 20;

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
        let mut reader = file;
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
                        let _ = app.emit(
                            "sync-upload-progress",
                            SyncProgressPayload {
                                game_id: game_id.clone(),
                                filename: filename.clone(),
                                loaded,
                                total,
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
            let _ = app.emit(
                "sync-upload-progress",
                SyncProgressPayload {
                    game_id,
                    filename,
                    loaded: total,
                    total,
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
    let _ = app.emit("sync-upload-done", ());

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

    tray_state.0.reset_upload_cancel();
    tray_state.0.reset_upload_pause();
    let result = sync_upload_game_impl(game_id, app.clone(), Some(tray_state.0.clone())).await;

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();

    let _ = app.emit("sync-upload-done", ());
    result
}

pub(crate) async fn sync_upload_game_impl(
    game_id: String,
    app: AppHandle,
    tray_inner: Option<std::sync::Arc<crate::tray_state::TrayStateInner>>,
) -> Result<SyncResultDto, String> {
    let cfg = crate::config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    if crate::process_check::is_game_running(&game_id, &game.paths) {
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

    // Archivos grandes (>= umbral) se suben por multipart (pausable/cancelable).
    let files_with_size: Vec<((String, String), u64)> = files
        .iter()
        .map(|(abs, rel)| {
            let size = fs::metadata(abs)
                .map_err(|e| format!("{}: {}", rel, e))
                .map(|m| m.len())?;
            Ok(((abs.clone(), rel.clone()), size))
        })
        .collect::<Result<Vec<_>, String>>()?;

    let (multipart_files, simple_files): (Vec<_>, Vec<_>) = files_with_size
        .into_iter()
        .partition(|(_, size)| *size >= multipart_upload::MULTIPART_THRESHOLD);

    let mut ok_count = 0u32;
    let mut err_count = 0u32;
    let mut errors = Vec::new();

    // Subida multipart para archivos grandes.
    for ((absolute, relative), total) in multipart_files {
        if let Some(ref t) = tray_inner {
            if t.upload_pause_requested() {
                break;
            }
        }
        let cancel = tray_inner.clone();
        match multipart_upload::upload_one_file_multipart(
            std::path::Path::new(&absolute),
            &relative,
            total,
            &game_id,
            api_base,
            user_id,
            api_key,
            app.clone(),
            cancel,
        )
        .await
        {
            Ok(()) => ok_count += 1,
            Err(e) => {
                if e == multipart_upload::PAUSED_ERR_MSG {
                    let _ = app.emit(
                        "sync-upload-paused",
                        serde_json::json!({
                            "gameId": game_id,
                            "filename": relative,
                        }),
                    );
                } else {
                    super::sync_logger::log_error(
                        "upload_multipart",
                        &super::sync_logger::upload_context(&game_id, &relative, &absolute),
                        &e,
                    );
                    errors.push(format!("{}: {}", relative, e));
                    err_count += 1;
                }
            }
        }
    }

    // Subida PUT simple para archivos pequeños. Pedir URLs por lotes (máx 500 por petición) para no saturar Lambda.
    const UPLOAD_URLS_BATCH_SIZE: usize = 500;
    if !simple_files.is_empty() {
        super::sync_logger::log_operation(
            "upload_simple_batch",
            &format!("gameId={} file_count={}", game_id, simple_files.len()),
        );
        let filenames: Vec<String> = simple_files.iter().map(|((_, r), _)| r.clone()).collect();
        let mut upload_urls = Vec::with_capacity(filenames.len());
        for chunk in filenames.chunks(UPLOAD_URLS_BATCH_SIZE) {
            let batch = api::get_upload_urls(api_base, user_id, api_key, &game_id, chunk)
                .await
                .map_err(|e| {
                    super::sync_logger::log_error(
                        "upload_urls",
                        &format!("gameId={}", game_id),
                        &e,
                    );
                    format!("upload-urls: {}", e)
                })?;
            upload_urls.extend(batch);
        }
        if upload_urls.len() != simple_files.len() {
            return Err(format!(
                "API devolvió {} URLs para {} archivos",
                upload_urls.len(),
                simple_files.len()
            ));
        }

        let total_simple = upload_urls.len();
        super::sync_logger::log_operation(
            "upload_simple_urls_ok",
            &format!(
                "gameId={} total={} batches={}",
                game_id,
                total_simple,
                (total_simple + UPLOAD_URLS_BATCH_SIZE - 1) / UPLOAD_URLS_BATCH_SIZE
            ),
        );

        let client = reqwest::Client::builder()
            .user_agent("sync-games-desktop/1.0")
            .build()
            .map_err(|e| e.to_string())?;

        let items: Vec<_> = simple_files
            .into_iter()
            .zip(upload_urls)
            .map(|(((abs, rel), total), (url, _))| (abs, rel, total, url))
            .collect();

        let mut put_count: usize = 0;
        let mut stream = stream::iter(items)
            .map(|(absolute, relative, total, upload_url)| {
                let client = client.clone();
                async move {
                    let body = match tokio::fs::read(&absolute).await {
                        Ok(b) => b,
                        Err(e) => {
                            return Err((
                                relative.clone(),
                                absolute,
                                format!("{}: {}", relative, e),
                            ));
                        }
                    };
                    let put_res = match client
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
                                format!("{}: {}", relative, e),
                            ));
                        }
                    };
                    if put_res.status().is_success() {
                        Ok(())
                    } else {
                        let msg = format!("{}: S3 PUT {}", relative, put_res.status());
                        Err((relative, absolute, msg))
                    }
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
                super::sync_logger::log_operation(
                    "upload_simple_progress",
                    &format!("gameId={} done={}/{}", game_id, put_count, total_simple),
                );
            }
            match result {
                Ok(()) => ok_count += 1,
                Err((relative, absolute, err_msg)) => {
                    super::sync_logger::log_error(
                        "upload_put",
                        &super::sync_logger::upload_context(game_id.as_str(), &relative, &absolute),
                        &err_msg,
                    );
                    errors.push(err_msg);
                    err_count += 1;
                }
            }
        }

        super::sync_logger::log_operation(
            "upload_simple_done",
            &format!("gameId={} files={}", game_id, total_simple),
        );
    }

    let result = SyncResultDto {
        ok_count,
        err_count,
        errors,
    };

    // Registrar en historial (errores o éxito).
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
        if crate::process_check::is_game_running(&game.id, &game.paths) {
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

    let results: Vec<GameSyncResultDto> = cfg
        .games
        .iter()
        .map(|g| results_by_id.get(&g.id).cloned().expect("result per game"))
        .collect();

    tray_state.0.syncing_dec();
    tray_state.0.clone().refresh_unsynced_async();

    let _ = app.emit("sync-upload-done", ());

    Ok(results)
}
