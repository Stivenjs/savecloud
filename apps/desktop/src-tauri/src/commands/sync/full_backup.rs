//! Módulo de backup completo de juegos mediante archivo `.tar` en S3.
//!
//! Agrupa todos los archivos de un juego en un único archivo `.tar`
//! para optimizar la transferencia hacia y desde almacenamiento remoto.
//!
//! Flujo de operación:
//!
//! 1. Empaquetado del directorio del juego en un archivo `.tar`.
//! 2. Subida del archivo mediante multipart upload.
//! 3. Identificación y gestión del backup mediante su clave en S3.
//! 4. Descarga y extracción del contenido en el sistema local.
//!
//! Este enfoque reduce la sobrecarga asociada a la transferencia de
//! múltiples archivos pequeños, siendo especialmente útil para juegos
//! con grandes volúmenes de datos.

use futures_util::StreamExt;
use std::fs;
use std::io::{BufWriter, ErrorKind};
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;
use tokio_util::io::SyncIoBridge;

use super::api;
use super::context::ApiContext;
use super::events::{
    emit_full_backup_done, emit_sync_download_done, emit_sync_download_progress,
    emit_sync_terminal, emit_sync_upload_done, emit_sync_upload_progress, sync_status_from_result,
};
use super::models::{SyncOperationStrategy, SyncProgressPayload};
use super::multipart_upload;
use super::streaming;
use crate::config;
use crate::network::DATA_CLIENT;
use crate::tray::tray_state::TrayState;
use tauri::{AppHandle, Manager, State};

use crate::shutdown::coordinator::{ShutdownCoordinator, ShutdownPhase};
use crate::shutdown::{ShutdownBus, ShutdownGuard};

/// Prefijo S3 para backups (key = userId/gameId/backups/<filename>.tar).
const BACKUPS_PREFIX: &str = "backups/";

fn get_api_context() -> Result<ApiContext, String> {
    super::context::resolve_api_context()
}

/// Crea un archivo .tar con el contenido de `source_dir` y lo escribe en `dest_path`.
/// No comprime (solo agrupa); muchos juegos ya están comprimidos.
fn create_tar_archive(source_dir: &Path, dest_path: &Path) -> Result<u64, String> {
    let file = fs::File::create(dest_path).map_err(|e| e.to_string())?;
    let writer = BufWriter::new(file);
    let mut builder = tar::Builder::new(writer);
    builder
        .append_dir_all(".", source_dir)
        .map_err(|e| e.to_string())?;
    builder.finish().map_err(|e| e.to_string())?;
    fs::metadata(dest_path)
        .map(|m| m.len())
        .map_err(|e| e.to_string())
}

/// Guard que elimina un archivo temporal al salir del scope (éxito o error).
struct TempFileGuard(PathBuf);
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupDto {
    key: String,
    last_modified: String,
    size: Option<u64>,
    filename: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudBackupInfo {
    pub key: String,
    pub last_modified: String,
    pub size: Option<u64>,
    pub filename: String,
}

/// Lista los backups en la nube para un juego.
pub async fn list_cloud_backups(
    api_base: &str,
    user_id: &str,
    api_key: &str,
    game_id: &str,
) -> Result<Vec<CloudBackupInfo>, String> {
    let path = format!("/backups?gameId={}", urlencoding::encode(game_id));

    let res = api::api_request(api_base, user_id, api_key, "GET", &path, None)
        .await
        .map_err(|e| format!("GET /backups: {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "API backups: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

    #[derive(serde::Deserialize)]
    struct Response {
        backups: Vec<BackupDto>,
    }

    let body: Response = res.json().await.map_err(|e| e.to_string())?;
    Ok(body
        .backups
        .into_iter()
        .map(|b| CloudBackupInfo {
            key: b.key,
            last_modified: b.last_modified,
            size: b.size,
            filename: b.filename,
        })
        .collect())
}

/// Cada cuántos bytes emitimos progreso de descarga del empaquetado.
const FULL_BACKUP_DOWNLOAD_EMIT_BYTES: u64 = 256 * 1024;

/// Quita solo lectura para poder borrar/sobrescribir (Unity y otros suelen dejar `.json` read-only).
#[cfg(windows)]
fn strip_readonly_for_overwrite(path: &Path) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileAttributesW, SetFileAttributesW, FILE_ATTRIBUTE_READONLY, INVALID_FILE_ATTRIBUTES,
    };

    let wide: Vec<u16> = OsStr::new(path).encode_wide().chain(Some(0)).collect();
    unsafe {
        let attrs = GetFileAttributesW(wide.as_ptr());
        if attrs == INVALID_FILE_ATTRIBUTES {
            return;
        }
        if attrs & FILE_ATTRIBUTE_READONLY != 0 {
            let _ = SetFileAttributesW(wide.as_ptr(), attrs & !FILE_ATTRIBUTE_READONLY);
        }
    }
}

#[cfg(not(windows))]
fn strip_readonly_for_overwrite(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    if let Ok(meta) = fs::metadata(path) {
        if meta.is_file() {
            let mut perm = meta.permissions();
            perm.set_mode(perm.mode() | 0o200);
            let _ = fs::set_permissions(path, perm);
        }
    }
}

/// Borra un archivo existente antes de que `tar` escriba de nuevo (evita fallos en Windows con atributo solo lectura).
fn remove_existing_file_for_unpack(target_path: &Path) -> Result<(), String> {
    if !target_path.exists() || !target_path.is_file() {
        return Ok(());
    }
    strip_readonly_for_overwrite(target_path);
    fs::remove_file(target_path).map_err(|e| {
        format!(
            "No se pudo sobrescribir \"{}\": {}. Cierra el juego si está en ejecución (el archivo puede estar bloqueado) e inténtalo de nuevo.",
            target_path.display(),
            e
        )
    })
}

fn unpack_extraction_hint(e: &std::io::Error) -> &'static str {
    match e.kind() {
        ErrorKind::PermissionDenied => {
            " Cierra el juego, revisa que el antivirus no bloquee la carpeta y vuelve a intentar."
        }
        ErrorKind::AlreadyExists => {
            " Si el error persiste, borra manualmente el archivo indicado e inténtalo de nuevo."
        }
        _ => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("being used")
                || msg.contains("en uso")
                || msg.contains("denied")
                || msg.contains("acc")
            {
                " Cierra el juego y cualquier programa que use esa carpeta, luego reintenta."
            } else {
                ""
            }
        }
    }
}

fn unpack_archive_resilient<R: std::io::Read>(
    archive: &mut tar::Archive<R>,
    dest_dir: &Path,
) -> Result<(), String> {
    let entries = archive
        .entries()
        .map_err(|e| format!("Fallo al leer entradas del backup: {}", e))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Entrada TAR inválida: {}", e))?;
        let rel_path = entry
            .path()
            .map_err(|e| format!("Ruta TAR inválida: {}", e))?
            .into_owned();
        let target_path = dest_dir.join(&rel_path);

        if entry.header().entry_type().is_file() && target_path.exists() {
            remove_existing_file_for_unpack(&target_path)?;
        }

        match entry.unpack_in(dest_dir) {
            Ok(true) => {}
            Ok(false) => {
                return Err(format!(
                    "Ruta insegura al extraer backup: {}",
                    rel_path.display()
                ));
            }
            Err(e) => {
                let hint = unpack_extraction_hint(&e);
                return Err(format!(
                    "Fallo en extracción [{}]: {}{}",
                    target_path.display(),
                    e,
                    hint
                ));
            }
        }
    }

    Ok(())
}

/// Implementa la descarga y extracción en streaming puro de un backup empaquetado.
///
/// Esta arquitectura elimina la necesidad de archivos temporales. Crea una tubería
/// bidireccional (pipe) en memoria RAM. El flujo de red escribe en el transmisor (`tx`)
/// mientras un hilo bloqueante dedicado consume el receptor (`rx`) y extrae los
/// archivos directamente a su destino final utilizando `SyncIoBridge`.
///
/// Esto proporciona el máximo rendimiento de I/O posible y reduce a la mitad
/// las escrituras físicas en el disco de almacenamiento.
///
/// # Parameters
///
/// * `game_id` - El identificador único del juego.
/// * `backup_key` - La clave o ruta del objeto en el almacenamiento remoto.
/// * `app` - El manejador de la aplicación Tauri, utilizado para emitir eventos de progreso.
/// * `tray_state` - Referencia atómica al estado de la bandeja del sistema.
/// * `emit_done` - Bandera que indica si se debe emitir el evento `sync-download-done` al finalizar.
///
/// # Errors
///
/// Retorna `Err(String)` ante fallos de red, errores de tubería en memoria,
/// o fallos de descompresión en el hilo secundario.
pub async fn download_and_restore_full_backup_impl(
    game_id: String,
    backup_key: String,
    app: AppHandle,
    tray_state: std::sync::Arc<crate::tray::tray_state::TrayStateInner>,
    emit_done: bool,
) -> Result<(), String> {
    let ctx = get_api_context()?;
    let cfg = config::load_config();

    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let dest_dir =
        crate::utils::path_utils::expand_path(game.paths.first().map(|s| s.as_str()).unwrap_or(""))
            .ok_or("No se pudo expandir la ruta del juego")?;
    let dest_dir = PathBuf::from(dest_dir);

    // Resolución de URL pre-firmada
    let body = serde_json::json!({ "gameId": game_id, "key": backup_key });
    let res = api::api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/download-url",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| format!("download-url: {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "API download-url: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let download_url = json
        .get("downloadUrl")
        .and_then(|v| v.as_str())
        .ok_or("API no devolvió downloadUrl")?;

    let tar_name = backup_key.rsplit('/').next().unwrap_or("backup.tar");

    let res = DATA_CLIENT
        .get(download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Descarga del backup: HTTP {}", res.status()));
    }

    let total = res.content_length().unwrap_or(0);
    let mut stream = res.bytes_stream();

    // Arquitectura de Streaming: Tubería (Pipe) en memoria RAM con capacidad de 5MB.
    // Proporciona retroalimentación de presión (backpressure): si el disco extrae
    // más lento de lo que la red descarga, la red se pausará temporalmente.
    let (mut tx, rx) = tokio::io::duplex(5 * 1024 * 1024);

    let dest_dir_clone = dest_dir.clone();

    // Hilo dedicado a la descompresión y extracción. Se ejecuta en paralelo a la descarga.
    let extract_task = tokio::task::spawn_blocking(move || {
        // SyncIoBridge convierte el canal asíncrono 'rx' en un lector implementando std::io::Read.
        let sync_reader = SyncIoBridge::new(rx);

        // Capa de descompresión: extrae los datos Zstd antes de pasarlos al TAR.
        let zstd_decoder = zstd::stream::read::Decoder::new(sync_reader)
            .map_err(|e| format!("fallo al inicializar descompresor Zstd: {}", e))?;

        let mut archive = tar::Archive::new(zstd_decoder);
        unpack_archive_resilient(&mut archive, &dest_dir_clone)
    });

    let mut loaded: u64 = 0;
    let mut last_emit: u64 = 0;

    // Consumo del flujo de red
    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        let n = chunk.len() as u64;
        loaded += n;

        // Escribir los bytes directamente en la memoria RAM hacia el descompresor
        tx.write_all(&chunk)
            .await
            .map_err(|e| format!("Error en tubería de memoria: {}", e))?;

        if loaded - last_emit >= FULL_BACKUP_DOWNLOAD_EMIT_BYTES || (total > 0 && loaded >= total) {
            last_emit = loaded;
            emit_sync_download_progress(
                &app,
                SyncProgressPayload {
                    operation_id: Some(format!("sync-download-{game_id}")),
                    status: Some("running".to_string()),
                    game_id: game_id.clone(),
                    filename: tar_name.to_string(),
                    loaded,
                    total,
                    downloaded_bytes: Some(loaded),
                    total_bytes: Some(total),
                    can_pause: None,
                    can_cancel: None,
                    can_resume: None,
                    strategy: Some(SyncOperationStrategy::DownloadPackaged),
                    state: None,
                    reason_code: None,
                },
            );
        }
    }

    if total > 0 && loaded < total {
        emit_sync_download_progress(
            &app,
            SyncProgressPayload {
                operation_id: Some(format!("sync-download-{game_id}")),
                status: Some("running".to_string()),
                game_id: game_id.clone(),
                filename: tar_name.to_string(),
                loaded: total,
                total,
                downloaded_bytes: Some(total),
                total_bytes: Some(total),
                can_pause: None,
                can_cancel: None,
                can_resume: None,
                strategy: Some(SyncOperationStrategy::DownloadPackaged),
                state: None,
                reason_code: None,
            },
        );
    }

    // Clausura del transmisor. Esto inyecta una señal EOF (End Of File) en el receptor,
    // indicando a 'tar::Archive' que el archivo ha finalizado de forma limpia.
    drop(tx);

    // Sincronización del hilo principal con la finalización del hilo extractor
    extract_task
        .await
        .map_err(|e| format!("Pánico en hilo de descompresión: {}", e))??;

    tray_state.set_just_restored(&game_id);
    emit_sync_terminal(
        &app,
        format!("sync-download-{game_id}"),
        "completed",
        "download",
        Some(game_id.clone()),
        None,
        None,
    );
    if emit_done {
        emit_sync_download_done(&app);
    }

    Ok(())
}

#[tauri::command]
pub async fn create_and_upload_full_backup(
    game_id: String,
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<String, String> {
    let ctx = get_api_context()?;
    let cfg = config::load_config();

    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let raw_path = game.paths.first().map(|s| s.as_str()).unwrap_or("");
    let source_dir =
        crate::utils::path_utils::expand_path(raw_path).ok_or("No se pudo expandir la ruta")?;
    let source_dir = PathBuf::from(&source_dir);

    if !source_dir.exists() || !source_dir.is_dir() {
        return Err("La carpeta del juego no existe".to_string());
    }

    let source_dir_for_size = source_dir.clone();
    let estimated_total = tokio::task::spawn_blocking(move || -> u64 {
        fn dir_size(path: &Path) -> u64 {
            let mut total = 0u64;
            let Ok(meta) = std::fs::metadata(path) else {
                return 0;
            };
            if meta.is_file() {
                return meta.len();
            }

            let Ok(read_dir) = std::fs::read_dir(path) else {
                return 0;
            };
            for entry in read_dir.flatten() {
                total += dir_size(&entry.path());
            }
            total
        }
        dir_size(&source_dir_for_size)
    })
    .await
    .unwrap_or(0);

    let temp_dir = std::env::temp_dir();
    let filename = format!("{}.tar", chrono::Utc::now().format("%Y-%m-%d_%H-%M-%S"));
    let tar_path = temp_dir.join(&filename);
    let relative_filename = format!("{}{}", BACKUPS_PREFIX, filename);

    tray_state.0.reset_upload_cancel();
    tray_state.0.reset_upload_pause();

    let use_streaming = cfg.full_backup_streaming.unwrap_or(false);
    let dry_run = cfg.full_backup_streaming_dry_run.unwrap_or(false);
    let backup_strategy = if use_streaming {
        SyncOperationStrategy::Streaming
    } else {
        SyncOperationStrategy::Multipart
    };

    emit_sync_upload_progress(
        &app,
        SyncProgressPayload {
            operation_id: Some(format!("sync-upload-{game_id}")),
            status: Some("running".to_string()),
            game_id: game_id.clone(),
            filename: "Empaquetando…".to_string(),
            loaded: 0,
            total: 1,
            downloaded_bytes: Some(0),
            total_bytes: Some(1),
            can_pause: Some(false),
            can_cancel: Some(false),
            can_resume: Some(false),
            strategy: Some(backup_strategy),
            state: None,
            reason_code: None,
        },
    );

    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();

    let result = if use_streaming && dry_run {
        let strategy = streaming::upload_strategy::UploadStrategy::for_file(estimated_total);

        let (rx, tar_handle) =
            streaming::tar_stream::spawn_tar_stream(source_dir, strategy.tar_channel_capacity);
        let upload_res = streaming::multipart::upload_tar_stream_multipart_dry_run(
            rx,
            &game_id,
            &relative_filename,
            estimated_total,
            app.clone(),
            Some(tray_state.0.clone()),
            None,
        )
        .await;
        let _ = tar_handle.await;
        upload_res
    } else if use_streaming {
        let strategy = streaming::upload_strategy::UploadStrategy::for_file(estimated_total);

        let (rx, tar_handle) =
            streaming::tar_stream::spawn_tar_stream(source_dir, strategy.tar_channel_capacity);

        // ── Registrar guard dinámico en el coordinator ──────────────────────
        // Esto garantiza que si el usuario cierra la app durante una subida,
        // el ShutdownCoordinator espera hasta 15 s a que la subida termine
        // (o la aborta y hace multipart_abort en S3 al cancelar el token).
        let shutdown_token = {
            match (
                app.try_state::<ShutdownCoordinator>(),
                app.try_state::<ShutdownBus>(),
            ) {
                (Some(coord), Some(bus)) => {
                    let (guard, handle) =
                        ShutdownGuard::new(format!("multipart_upload_{}", game_id), &bus.token());
                    let coord_clone = (*coord).clone();
                    tauri::async_runtime::spawn(async move {
                        coord_clone
                            .register(ShutdownPhase::NetworkUploads, handle)
                            .await;
                    });
                    Some(guard)
                }
                _ => None,
            }
        };
        let token_for_upload = shutdown_token.as_ref().map(|g| g.token());

        let upload_res = streaming::multipart::upload_tar_stream_multipart(
            rx,
            &game_id,
            &relative_filename,
            estimated_total,
            &ctx.base_url,
            &ctx.user_id,
            &ctx.api_key,
            app.clone(),
            Some(tray_state.0.clone()),
            token_for_upload,
        )
        .await;

        let _ = tar_handle.await;

        // El guard se dropea aquí → ShutdownGuard::drop() lo marca Completed
        // automáticamente si la subida ya terminó (éxito o error).
        drop(shutdown_token);

        upload_res
    } else {
        let source_dir_clone = source_dir.clone();
        let tar_path_clone = tar_path.clone();

        let size = tokio::task::spawn_blocking(move || {
            create_tar_archive(&source_dir_clone, &tar_path_clone)
        })
        .await
        .map_err(|e| e.to_string())??;

        let _temp_guard = TempFileGuard(tar_path.clone());

        emit_sync_upload_progress(
            &app,
            SyncProgressPayload {
                operation_id: Some(format!("sync-upload-{game_id}")),
                status: Some("running".to_string()),
                game_id: game_id.clone(),
                filename: relative_filename.clone(),
                loaded: 0,
                total: size,
                downloaded_bytes: Some(0),
                total_bytes: Some(size),
                can_pause: None,
                can_cancel: None,
                can_resume: None,
                strategy: Some(SyncOperationStrategy::Multipart),
                state: None,
                reason_code: None,
            },
        );

        multipart_upload::upload_one_file_multipart(
            &tar_path,
            &relative_filename,
            size,
            &game_id,
            &ctx.base_url,
            &ctx.user_id,
            &ctx.api_key,
            app.clone(),
            Some(tray_state.0.clone()),
        )
        .await
    };

    tray_state.0.syncing_dec();
    tray_state.0.update_tooltip();

    let status = if tray_state.0.upload_cancel_requested() {
        "cancelled"
    } else {
        sync_status_from_result(&result)
    };
    let reason_code = match &result {
        Err(e) if e.contains("pausa no soportada") => {
            Some("PAUSE_NOT_SUPPORTED_BY_STRATEGY".to_string())
        }
        Err(e) if e.contains("subida cancelada") => Some("CANCELLED_BY_USER".to_string()),
        _ => None,
    };
    emit_sync_terminal(
        &app,
        format!("sync-upload-{game_id}"),
        status,
        "upload",
        Some(game_id.clone()),
        None,
        reason_code,
    );
    emit_full_backup_done(&app);

    if result.is_ok() {
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        emit_sync_upload_done(&app);
    }

    result.map(|_| relative_filename)
}

#[tauri::command]
pub async fn list_full_backups(game_id: String) -> Result<Vec<CloudBackupInfo>, String> {
    let ctx = get_api_context()?;
    list_cloud_backups(&ctx.base_url, &ctx.user_id, &ctx.api_key, &game_id).await
}

#[tauri::command]
pub async fn list_full_backups_batch(
    game_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, Vec<CloudBackupInfo>>, String> {
    use futures_util::FutureExt;

    let game_ids: Vec<String> = game_ids
        .into_iter()
        .filter(|id| !id.trim().is_empty())
        .collect();
    if game_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let ctx = get_api_context()?;
    let empty: Vec<CloudBackupInfo> = Vec::new();

    let futures: Vec<_> = game_ids
        .iter()
        .map(|game_id| {
            let game_id = game_id.clone();
            let api_base = ctx.base_url.clone();
            let user_id = ctx.user_id.clone();
            let api_key = ctx.api_key.clone();
            let fallback = empty.clone();

            async move {
                let result = list_cloud_backups(&api_base, &user_id, &api_key, &game_id).await;
                (game_id, result.unwrap_or(fallback))
            }
            .boxed()
        })
        .collect();

    let results = futures_util::future::join_all(futures).await;
    Ok(results.into_iter().collect())
}

#[tauri::command]
pub async fn download_and_restore_full_backup(
    game_id: String,
    backup_key: String,
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<(), String> {
    download_and_restore_full_backup_impl(game_id, backup_key, app, tray_state.0.clone(), true)
        .await
}

#[tauri::command]
pub async fn delete_cloud_backup(game_id: String, backup_key: String) -> Result<(), String> {
    let ctx = get_api_context()?;
    let body = serde_json::json!({ "gameId": game_id, "key": backup_key });

    let res = api::api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "DELETE",
        "/backup",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| format!("delete backup: {}", e))?;

    if !res.status().is_success() && res.status() != reqwest::StatusCode::NO_CONTENT {
        return Err(format!(
            "API delete backup: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn rename_cloud_backup(
    game_id: String,
    backup_key: String,
    new_filename: String,
) -> Result<(), String> {
    let ctx = get_api_context()?;
    let new_filename = new_filename.trim();

    if new_filename.is_empty() || !new_filename.ends_with(".tar") {
        return Err("El nuevo nombre debe terminar en .tar (ej. mi-backup.tar)".to_string());
    }
    if new_filename.contains('/') || new_filename.contains("..") {
        return Err("El nombre no puede contener rutas.".to_string());
    }

    let body = serde_json::json!({
        "gameId": game_id,
        "key": backup_key,
        "newFilename": new_filename
    });

    let res = api::api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "PATCH",
        "/backup",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| format!("rename backup: {}", e))?;

    if !res.status().is_success() && res.status() != reqwest::StatusCode::NO_CONTENT {
        return Err(format!(
            "API rename backup: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }
    Ok(())
}
