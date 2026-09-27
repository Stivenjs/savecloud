//! Respaldo en la nube de la configuración activa cuando cambia su contenido.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tokio::sync::Mutex;

static BACKUP_LOCK: Mutex<()> = Mutex::const_new(());

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupFingerprint {
    scope: String,
    content_hash: String,
}

fn fingerprint_path() -> Result<PathBuf, String> {
    crate::config::paths::core_dir()
        .map(|dir| dir.join("cloud-config-backup.json"))
        .ok_or_else(|| "No se pudo resolver el directorio de datos de SaveCloud".to_string())
}

fn read_fingerprint(path: &PathBuf) -> Option<BackupFingerprint> {
    fs::read_to_string(path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok())
}

fn write_fingerprint(path: &PathBuf, fingerprint: &BackupFingerprint) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "No se pudo resolver el directorio del estado del respaldo".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let temp_path = path.with_extension("json.tmp");
    let content = serde_json::to_vec(fingerprint).map_err(|error| error.to_string())?;
    fs::write(&temp_path, content).map_err(|error| error.to_string())?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temp_path, path).map_err(|error| error.to_string())
}

/// Sube la configuración combinada solo si cambió desde el último respaldo exitoso.
pub async fn backup_config_if_changed() -> Result<bool, String> {
    backup_config(false).await
}

/// Sube un respaldo solicitado por el usuario aunque el contenido no haya cambiado.
pub async fn backup_config_force() -> Result<(), String> {
    backup_config(true).await.map(|_| ())
}

async fn backup_config(force: bool) -> Result<bool, String> {
    let _guard = BACKUP_LOCK.lock().await;
    let context = crate::commands::sync::context::resolve_api_context()?;
    let combined = crate::config::backup_snapshot::sanitized_config_snapshot(
        &crate::config::get_combined_config(),
    );
    let bytes = serde_json::to_vec(&combined).map_err(|error| error.to_string())?;
    let content_hash = hex::encode(Sha256::digest(&bytes));
    let scope = format!("{}::{}", context.base_url, context.user_id);
    let path = fingerprint_path()?;

    if !force
        && read_fingerprint(&path)
            .is_some_and(|previous| previous.scope == scope && previous.content_hash == content_hash)
    {
        return Ok(false);
    }

    crate::config::config_cmds::s3_transfer(
        &context.base_url,
        &context.user_id,
        &context.api_key,
        "config.json",
        Some(bytes),
        true,
    )
    .await?;

    write_fingerprint(
        &path,
        &BackupFingerprint {
            scope,
            content_hash,
        },
    )?;

    Ok(true)
}

#[tauri::command]
pub async fn backup_config_to_cloud_if_changed() -> Result<bool, String> {
    backup_config_if_changed().await
}

/// Observa cambios persistidos en ajustes, biblioteca, historial e índice de perfiles.
pub fn spawn_config_backup_watcher() -> Result<(), String> {
    use notify::{RecursiveMode, Watcher};
    use std::time::Duration;

    let data_dir = crate::config::paths::data_dir()
        .ok_or_else(|| "No se pudo resolver el directorio de configuración de SaveCloud".to_string())?;
    let profile_dir = data_dir.join("profiles");
    let (event_tx, mut event_rx) = tokio::sync::mpsc::channel::<()>(16);

    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else { return };
        let changed = event.paths.iter().any(|path| {
            matches!(
                path.file_name().and_then(|name| name.to_str()),
                Some("settings.json" | "library.json" | "history.json" | "profiles.json")
            )
        });
        if changed {
            let _ = event_tx.try_send(());
        }
    })
    .map_err(|error| format!("No se pudo iniciar el watcher de configuración: {error}"))?;

    watcher
        .watch(&data_dir, RecursiveMode::NonRecursive)
        .map_err(|error| format!("No se pudo observar la configuración: {error}"))?;
    if profile_dir.is_dir() {
        watcher
            .watch(&profile_dir, RecursiveMode::Recursive)
            .map_err(|error| format!("No se pudieron observar los perfiles: {error}"))?;
    }

    tauri::async_runtime::spawn(async move {
        let _watcher = watcher;
        while event_rx.recv().await.is_some() {
            loop {
                match tokio::time::timeout(Duration::from_millis(1800), event_rx.recv()).await {
                    Ok(Some(())) => continue,
                    _ => break,
                }
            }

            if let Err(error) = backup_config_if_changed().await {
                log::warn!("[config_backup] Respaldo automático pendiente: {error}");
            }
        }
    });

    Ok(())
}
