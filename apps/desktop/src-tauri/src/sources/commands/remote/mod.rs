//! Fuentes remotas registradas y sincronización.

pub mod sync;

use sha2::{Digest, Sha256};
use url::Url;

use super::super::domain::{RemoteSourceConfig, SourceSyncMetadata};
use super::super::store;

pub(crate) fn normalize_remote_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("La URL no puede estar vacía".to_string());
    }

    let parsed = Url::parse(trimmed).map_err(|e| format!("URL inválida: {e}"))?;
    if parsed.scheme() != "https" {
        return Err("Solo se permiten URLs HTTPS para fuentes remotas".to_string());
    }

    Ok(parsed.to_string())
}

pub(crate) fn remote_source_id(url: &str) -> String {
    let digest = Sha256::digest(url.as_bytes());
    let hexed = hex::encode(digest);
    format!("remote-{}", &hexed[..12])
}

/// Lista fuentes remotas registradas.
#[tauri::command]
pub async fn list_remote_sources() -> Result<Vec<RemoteSourceConfig>, String> {
    store::load_remote_sources()
}

/// Crea o actualiza una fuente remota por URL.
#[tauri::command]
pub async fn upsert_remote_source(
    url: String,
    enabled: Option<bool>,
) -> Result<RemoteSourceConfig, String> {
    let normalized = normalize_remote_url(&url)?;
    let mut config = store::load_remote_sources()?
        .into_iter()
        .find(|source| source.url == normalized)
        .unwrap_or(RemoteSourceConfig {
            id: remote_source_id(&normalized),
            url: normalized.clone(),
            enabled: true,
            sync: SourceSyncMetadata::default(),
        });

    config.url = normalized;
    if let Some(next_enabled) = enabled {
        config.enabled = next_enabled;
    }

    store::upsert_remote_source(config)
}

/// Elimina una fuente remota por ID.
#[tauri::command]
pub async fn remove_remote_source(source_id: String) -> Result<(), String> {
    store::remove_remote_source(&source_id)
}

/// Activa o pausa una fuente remota.
#[tauri::command]
pub async fn set_remote_source_enabled(
    source_id: String,
    enabled: bool,
) -> Result<RemoteSourceConfig, String> {
    let mut remote_sources = store::load_remote_sources()?;
    let Some(index) = remote_sources
        .iter()
        .position(|source| source.id == source_id)
    else {
        return Err(format!("Fuente remota no encontrada: {source_id}"));
    };

    remote_sources[index].enabled = enabled;
    let updated = remote_sources[index].clone();
    store::save_remote_sources(&remote_sources)?;
    Ok(updated)
}
