//! Backup completo del juego como un solo archivo .tar en S3.
//!
//! Flujo: empaquetar carpeta en .tar → subir con multipart → listar/descargar por key → extraer.
//! Pensado para juegos pesados con muchos archivos (una sola subida/descarga en lugar de miles).

use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

use super::api;
use super::models::SyncProgressPayload;
use super::multipart_upload;
use super::streaming;
use crate::config;
use crate::tray_state::TrayState;
use tauri::{AppHandle, Emitter, State};

/// Prefijo S3 para backups (key = userId/gameId/backups/<filename>.tar).
const BACKUPS_PREFIX: &str = "backups/";

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

/// Extrae un .tar en `dest_dir`.
fn extract_tar_archive(tar_path: &Path, dest_dir: &Path) -> Result<(), String> {
    let file = fs::File::open(tar_path).map_err(|e| e.to_string())?;
    let mut archive = tar::Archive::new(file);
    archive.unpack(dest_dir).map_err(|e| e.to_string())?;
    Ok(())
}

/// DTO devuelto por la API al listar backups.
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

/// Lista los backups en la nube para un juego (GET /saves/backups?gameId=xxx).
pub async fn list_cloud_backups(
    api_base: &str,
    user_id: &str,
    api_key: &str,
    game_id: &str,
) -> Result<Vec<CloudBackupInfo>, String> {
    let url = format!(
        "{}/saves/backups?gameId={}",
        api_base.trim_end_matches('/'),
        urlencoding::encode(game_id)
    );
    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(&url)
        .header("x-user-id", user_id)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API backups: {} {}", status, text));
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

/// Crea un backup .tar del juego y lo sube a S3 con multipart.
#[tauri::command]
pub async fn create_and_upload_full_backup(
    game_id: String,
    app: AppHandle,
    tray_state: State<'_, TrayState>,
) -> Result<String, String> {
    let cfg = config::load_config();
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

    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;
    let raw_path = game.paths.first().map(|s| s.as_str()).unwrap_or("");
    let source_dir =
        super::path_utils::expand_path(raw_path).ok_or("No se pudo expandir la ruta del juego")?;
    let source_dir = PathBuf::from(&source_dir);
    if !source_dir.exists() || !source_dir.is_dir() {
        return Err("La carpeta del juego no existe".to_string());
    }

    // Estimamos el tamaño total del juego en disco para poder calcular ETA real
    // tanto en backups empaquetados clásicos como en streaming.
    let source_dir_for_size = PathBuf::from(&source_dir);
    let estimated_total = tokio::task::spawn_blocking(move || -> u64 {
        fn dir_size(path: &std::path::Path) -> u64 {
            let mut total = 0u64;
            let meta = match std::fs::metadata(path) {
                Ok(m) => m,
                Err(_) => return 0,
            };
            if meta.is_file() {
                return meta.len();
            }
            let read_dir = match std::fs::read_dir(path) {
                Ok(rd) => rd,
                Err(_) => return 0,
            };
            for entry in read_dir.flatten() {
                let p = entry.path();
                total += dir_size(&p);
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

    // Progreso para la UI: fase "Empaquetando..." (total=1 para que se muestre la barra).
    let _ = app.emit(
        "sync-upload-progress",
        SyncProgressPayload {
            game_id: game_id.clone(),
            filename: "Empaquetando…".to_string(),
            loaded: 0,
            total: 1,
        },
    );

    let use_streaming = cfg.full_backup_streaming.unwrap_or(false);
    let dry_run = cfg.full_backup_streaming_dry_run.unwrap_or(false);

    tray_state.0.syncing_inc();
    tray_state.0.update_tooltip();

    let result = if use_streaming && dry_run {
        let (rx, tar_handle) = streaming::tar_stream::spawn_tar_stream(source_dir.clone(), 8);
        let upload_res = streaming::multipart::upload_tar_stream_multipart_dry_run(
            rx,
            &game_id,
            &relative_filename,
            estimated_total,
            app.clone(),
            Some(tray_state.0.clone()),
        )
        .await;
        let _ = tar_handle.await;
        upload_res
    } else if use_streaming {
        let (rx, tar_handle) = streaming::tar_stream::spawn_tar_stream(source_dir.clone(), 8);
        let upload_res = streaming::multipart::upload_tar_stream_multipart(
            rx,
            &game_id,
            &relative_filename,
            estimated_total,
            api_base,
            user_id,
            api_key,
            app.clone(),
            Some(tray_state.0.clone()),
        )
        .await;
        let _ = tar_handle.await;
        upload_res
    } else {
        // Empaquetado bloqueante en un hilo dedicado para no bloquear el runtime async.
        let source_dir_clone = source_dir.clone();
        let tar_path_clone = tar_path.clone();
        let size = tokio::task::spawn_blocking(move || {
            create_tar_archive(&source_dir_clone, &tar_path_clone)
        })
        .await
        .map_err(|e| e.to_string())??;
        // Eliminar el .tar de disco siempre al salir (tras subir o si falla la subida).
        let _temp_guard = TempFileGuard(tar_path.clone());
        // Fase "Subiendo paquete": la multipart emitirá el progreso real por bytes.
        let _ = app.emit(
            "sync-upload-progress",
            SyncProgressPayload {
                game_id: game_id.clone(),
                filename: relative_filename.clone(),
                loaded: 0,
                total: size,
            },
        );

        multipart_upload::upload_one_file_multipart(
            &tar_path,
            &relative_filename,
            size,
            &game_id,
            api_base,
            user_id,
            api_key,
            app.clone(),
            Some(tray_state.0.clone()),
        )
        .await
    };

    tray_state.0.syncing_dec();
    tray_state.0.update_tooltip();
    let _ = app.emit("full-backup-done", ());
    if result.is_ok() {
        let _ = app.emit("sync-upload-done", ());
    }

    result?;
    Ok(relative_filename)
}

/// Lista los backups en la nube para un juego.
#[tauri::command]
pub async fn list_full_backups(game_id: String) -> Result<Vec<CloudBackupInfo>, String> {
    let cfg = config::load_config();
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

    list_cloud_backups(api_base, user_id, api_key, &game_id).await
}

/// Lista los backups en la nube para varios juegos en una sola invocación (peticiones en paralelo).
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

    let cfg = config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?
        .to_string();
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?
        .to_string();
    let api_key = cfg.api_key.as_deref().unwrap_or("").to_string();

    let empty: Vec<CloudBackupInfo> = Vec::new();
    let futures: Vec<_> = game_ids
        .iter()
        .map(|game_id| {
            let game_id = game_id.clone();
            let api_base = api_base.clone();
            let user_id = user_id.clone();
            let api_key = api_key.clone();
            let fallback = empty.clone();
            async move {
                let result = list_cloud_backups(&api_base, &user_id, &api_key, &game_id).await;
                (game_id, result.unwrap_or(fallback))
            }
            .boxed()
        })
        .collect();

    let results = futures_util::future::join_all(futures).await;
    let map: std::collections::HashMap<String, Vec<CloudBackupInfo>> =
        results.into_iter().collect();

    Ok(map)
}

/// Cada cuántos bytes emitimos progreso de descarga del empaquetado.
const FULL_BACKUP_DOWNLOAD_EMIT_BYTES: u64 = 256 * 1024;

/// Implementación de descarga + extracción de un backup empaquetado.
/// Si `emit_done` es false (p. ej. en "descargar todos"), no emite sync-download-done al terminar
/// para que la barra de progreso siga visible hasta que termine toda la operación.
pub async fn download_and_restore_full_backup_impl(
    game_id: String,
    backup_key: String,
    app: AppHandle,
    tray_state: std::sync::Arc<crate::tray_state::TrayStateInner>,
    emit_done: bool,
) -> Result<(), String> {
    let cfg = config::load_config();
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

    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let dest_dir =
        super::path_utils::expand_path(game.paths.first().map(|s| s.as_str()).unwrap_or(""))
            .ok_or("No se pudo expandir la ruta del juego")?;
    let dest_dir = PathBuf::from(dest_dir);

    let body = serde_json::json!({ "gameId": game_id, "key": backup_key });
    let body_bytes = body.to_string().into_bytes();
    let res = api::api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/download-url",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("download-url: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API download-url: {} {}", status, text));
    }
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let download_url = json
        .get("downloadUrl")
        .and_then(|v| v.as_str())
        .ok_or("API no devolvió downloadUrl")?;

    let temp_dir = std::env::temp_dir();
    let tar_name = backup_key.rsplit('/').next().unwrap_or("backup.tar");
    let tar_path = temp_dir.join(tar_name);

    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Descarga del backup: HTTP {}", res.status()));
    }
    let total = res.content_length().unwrap_or(0);
    let mut stream = res.bytes_stream();
    let mut file = tokio::fs::File::create(&tar_path)
        .await
        .map_err(|e| e.to_string())?;
    let mut loaded: u64 = 0;
    let mut last_emit: u64 = 0;

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| e.to_string())?;
        let n = chunk.len() as u64;
        loaded += n;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        if loaded - last_emit >= FULL_BACKUP_DOWNLOAD_EMIT_BYTES || (total > 0 && loaded >= total) {
            last_emit = loaded;
            let _ = app.emit(
                "sync-download-progress",
                SyncProgressPayload {
                    game_id: game_id.clone(),
                    filename: tar_name.to_string(),
                    loaded,
                    total,
                },
            );
        }
    }
    if total > 0 && loaded < total {
        let _ = app.emit(
            "sync-download-progress",
            SyncProgressPayload {
                game_id: game_id.clone(),
                filename: tar_name.to_string(),
                loaded: total,
                total,
            },
        );
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    let _ = app.emit(
        "sync-download-progress",
        SyncProgressPayload {
            game_id: game_id.clone(),
            filename: "Extrayendo…".to_string(),
            loaded: 0,
            total: 1,
        },
    );
    extract_tar_archive(&tar_path, &dest_dir)?;
    let _ = fs::remove_file(&tar_path);

    tray_state.set_just_restored(&game_id);
    if emit_done {
        let _ = app.emit("sync-download-done", ());
    }
    Ok(())
}

/// Comando Tauri: descarga un backup por key y lo extrae en la carpeta del juego.
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

/// Elimina un backup empaquetado de la nube por key.
#[tauri::command]
pub async fn delete_cloud_backup(game_id: String, backup_key: String) -> Result<(), String> {
    let cfg = config::load_config();
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

    let body = serde_json::json!({ "gameId": game_id, "key": backup_key });
    let body_bytes = body.to_string().into_bytes();
    let res = api::api_request(
        api_base,
        user_id,
        api_key,
        "DELETE",
        "/backup",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("delete backup: {}", e))?;
    if !res.status().is_success() && res.status() != reqwest::StatusCode::NO_CONTENT {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API delete backup: {} {}", status, text));
    }
    Ok(())
}

/// Renombra un backup empaquetado en la nube. new_filename debe ser solo el nombre .tar (ej. "mi-backup.tar").
#[tauri::command]
pub async fn rename_cloud_backup(
    game_id: String,
    backup_key: String,
    new_filename: String,
) -> Result<(), String> {
    let cfg = config::load_config();
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
    let body_bytes = body.to_string().into_bytes();
    let res = api::api_request(
        api_base,
        user_id,
        api_key,
        "PATCH",
        "/backup",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("rename backup: {}", e))?;
    if !res.status().is_success() && res.status() != reqwest::StatusCode::NO_CONTENT {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API rename backup: {} {}", status, text));
    }
    Ok(())
}
