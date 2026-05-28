//! Persistencia local del módulo de fuentes.

use std::path::PathBuf;

use crate::config::paths;

use super::domain::{ImportMode, RemoteSourceConfig, SourceCatalog, SourceDownloadJob};

fn sources_path() -> Result<PathBuf, String> {
    let Some(path) = paths::sources_path() else {
        return Err("No se pudo resolver sources_path".to_string());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

fn jobs_path() -> Result<PathBuf, String> {
    let Some(path) = paths::active_jobs_path() else {
        return Err("No se pudo resolver active_jobs_path".to_string());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

fn remote_sources_path() -> Result<PathBuf, String> {
    let Some(path) = paths::remote_sources_path() else {
        return Err("No se pudo resolver remote_sources_path".to_string());
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Indica si ya existe un catálogo persistido para la URL remota indicada.
pub fn catalog_exists_for_url(url: &str) -> Result<bool, String> {
    Ok(load_sources()?
        .iter()
        .any(|catalog| catalog.source_url.as_deref() == Some(url)))
}

/// Carga catálogo de fuentes persistido (siempre desde la ruta canónica en `cache/`).
pub fn load_sources() -> Result<Vec<SourceCatalog>, String> {
    let primary = sources_path()?;
    if primary.exists() {
        return read_sources_file(&primary);
    }

    if let Some(legacy) = paths::legacy_sources_path() {
        if legacy.exists() {
            let sources = read_sources_file(&legacy)?;
            save_sources(&sources)?;
            return Ok(sources);
        }
    }

    Ok(Vec::new())
}

/// Guarda catálogo de fuentes en la ruta canónica (`cache/sources.json`).
pub fn save_sources(sources: &[SourceCatalog]) -> Result<(), String> {
    let path = sources_path()?;
    let payload = serde_json::to_vec_pretty(sources).map_err(|e| e.to_string())?;
    write_bytes_atomic(&path, &payload)
}

fn read_sources_file(path: &std::path::Path) -> Result<Vec<SourceCatalog>, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("No se pudo parsear sources.json: {e}"))
}

/// Carga la configuración de fuentes remotas registradas.
pub fn load_remote_sources() -> Result<Vec<RemoteSourceConfig>, String> {
    let path = resolve_read_path(
        paths::remote_sources_path(),
        paths::legacy_remote_sources_path(),
    )?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes)
        .map_err(|e| format!("No se pudo parsear remote_sources.json: {e}"))
}

/// Guarda la configuración de fuentes remotas.
pub fn save_remote_sources(sources: &[RemoteSourceConfig]) -> Result<(), String> {
    let path = remote_sources_path()?;
    let payload = serde_json::to_vec_pretty(sources).map_err(|e| e.to_string())?;
    write_bytes_if_changed(&path, &payload)
}

/// Inserta o actualiza una fuente remota por `id`.
pub fn upsert_remote_source(config: RemoteSourceConfig) -> Result<RemoteSourceConfig, String> {
    let mut remote_sources = load_remote_sources()?;
    if let Some(existing) = remote_sources.iter_mut().find(|s| s.id == config.id) {
        *existing = config.clone();
    } else {
        remote_sources.push(config.clone());
    }
    save_remote_sources(&remote_sources)?;
    Ok(config)
}

/// Elimina una fuente remota por `id`.
pub fn remove_remote_source(source_id: &str) -> Result<(), String> {
    let mut remote_sources = load_remote_sources()?;
    remote_sources.retain(|s| s.id != source_id);
    save_remote_sources(&remote_sources)
}

/// Aplica merge/replace/update sobre fuentes existentes.
pub fn upsert_catalog(catalog: SourceCatalog, mode: ImportMode) -> Result<SourceCatalog, String> {
    let mut sources = load_sources()?;
    match mode {
        ImportMode::Replace => {
            sources = vec![catalog.clone()];
        }
        ImportMode::Merge => {
            if let Some(existing) = sources.iter_mut().find(|s| s.id == catalog.id) {
                *existing = catalog.clone();
            } else {
                sources.push(catalog.clone());
            }
        }
        ImportMode::UpdateOrCreate => {
            // Busca por nombre: si existe fuente con el mismo nombre, la reemplaza
            // (mantiene el ID original para no romper referencias)
            if let Some(existing) = sources.iter_mut().find(|s| s.name == catalog.name) {
                let old_id = existing.id.clone();
                *existing = catalog.clone();
                existing.id = old_id; // Conserva el ID estable
            } else {
                sources.push(catalog.clone());
            }
        }
    }
    save_sources(&sources)?;
    Ok(catalog)
}

/// Elimina un catálogo por ID.
pub fn remove_catalog(source_id: &str) -> Result<(), String> {
    let mut sources = load_sources()?;
    sources.retain(|s| s.id != source_id);
    save_sources(&sources)
}

/// Carga jobs activos/históricos.
pub fn load_jobs() -> Result<Vec<SourceDownloadJob>, String> {
    let path = resolve_read_path(paths::active_jobs_path(), paths::legacy_active_jobs_path())?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("No se pudo parsear active_jobs.json: {e}"))
}

/// Guarda jobs.
pub fn save_jobs(jobs: &[SourceDownloadJob]) -> Result<(), String> {
    let path = jobs_path()?;
    let payload = serde_json::to_vec_pretty(jobs).map_err(|e| e.to_string())?;
    write_bytes_if_changed(&path, &payload)
}

fn resolve_read_path(primary: Option<PathBuf>, legacy: Option<PathBuf>) -> Result<PathBuf, String> {
    let Some(primary) = primary else {
        return Err("No se pudo resolver ruta principal".to_string());
    };
    if primary.exists() {
        return Ok(primary);
    }
    if let Some(legacy) = legacy {
        if legacy.exists() {
            return Ok(legacy);
        }
    }
    Ok(primary)
}

fn write_bytes_if_changed(path: &std::path::Path, payload: &[u8]) -> Result<(), String> {
    if let Ok(existing) = std::fs::read(path) {
        if existing == payload {
            return Ok(());
        }
    }
    write_bytes_atomic(path, payload)
}

fn write_bytes_atomic(path: &std::path::Path, payload: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let temp = path.with_file_name(format!(
        "{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("file.json")
    ));
    std::fs::write(&temp, payload).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&temp, path).map_err(|e| e.to_string())
}
