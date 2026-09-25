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

const VERIFIED_SOURCES_JSON: &str = include_str!("../../../../resources/verified_sources.json");

/// Estructura de estado para las fuentes verificadas de la aplicación.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedSourcesStatus {
    /// Cantidad total de fuentes verificadas predefinidas en la app.
    pub total: usize,
    /// Cantidad de fuentes verificadas que el usuario tiene actualmente registradas.
    pub installed: usize,
    /// Indica si todas las fuentes verificadas ya están instaladas y registradas.
    pub all_installed: bool,
    /// Lista de fuentes verificadas predefinidas.
    pub preset_sources: Vec<RemoteSourceConfig>,
}

/// Obtiene la lista predefinida de fuentes verificadas embebida en el binario.
pub fn get_verified_sources_preset() -> Result<Vec<RemoteSourceConfig>, String> {
    serde_json::from_str(VERIFIED_SOURCES_JSON)
        .map_err(|e| format!("No se pudo parsear el listado de fuentes verificadas: {e}"))
}

/// Consulta el estado actual de instalación de las fuentes verificadas.
#[tauri::command]
pub async fn get_verified_sources_status() -> Result<VerifiedSourcesStatus, String> {
    let presets = get_verified_sources_preset()?;
    let current = store::load_remote_sources()?;

    let installed_count = presets
        .iter()
        .filter(|preset| current.iter().any(|c| c.url == preset.url))
        .count();

    let all_installed = installed_count >= presets.len() && !presets.is_empty();

    Ok(VerifiedSourcesStatus {
        total: presets.len(),
        installed: installed_count,
        all_installed,
        preset_sources: presets,
    })
}

/// Instala o restaura las fuentes verificadas en la configuración del usuario y opcionalmente inicia la sincronización.
#[tauri::command]
pub async fn install_verified_sources(
    app: tauri::AppHandle,
    sync_now: Option<bool>,
) -> Result<crate::sources::domain::RemoteSyncResult, String> {
    let presets = get_verified_sources_preset()?;
    let mut current = store::load_remote_sources()?;

    for preset in presets {
        if let Some(existing) = current.iter_mut().find(|s| s.url == preset.url) {
            existing.enabled = true;
        } else {
            current.push(preset);
        }
    }

    store::save_remote_sources(&current)?;

    if sync_now.unwrap_or(true) {
        sync::sync_remote_sources(app, None).await
    } else {
        Ok(crate::sources::domain::RemoteSyncResult {
            total: current.len(),
            updated: 0,
            unchanged: current.len(),
            failed: 0,
            items: Vec::new(),
        })
    }
}

