//! Persistencia local del módulo de fuentes.

use std::path::PathBuf;

use crate::config::paths;

use super::domain::{ImportMode, SourceCatalog, SourceDownloadJob};

fn sources_path() -> Result<PathBuf, String> {
    let Some(data_dir) = paths::data_dir() else {
        return Err("No se pudo resolver data_dir".to_string());
    };
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("sources.json"))
}

fn jobs_path() -> Result<PathBuf, String> {
    let Some(data_dir) = paths::data_dir() else {
        return Err("No se pudo resolver data_dir".to_string());
    };
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("active_jobs.json"))
}

/// Carga catálogo de fuentes persistido.
pub fn load_sources() -> Result<Vec<SourceCatalog>, String> {
    let path = sources_path()?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&bytes).map_err(|e| format!("No se pudo parsear sources.json: {e}"))
}

/// Guarda catálogo de fuentes.
pub fn save_sources(sources: &[SourceCatalog]) -> Result<(), String> {
    let path = sources_path()?;
    let payload = serde_json::to_vec_pretty(sources).map_err(|e| e.to_string())?;
    std::fs::write(path, payload).map_err(|e| e.to_string())
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
    let path = jobs_path()?;
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
    std::fs::write(path, payload).map_err(|e| e.to_string())
}
