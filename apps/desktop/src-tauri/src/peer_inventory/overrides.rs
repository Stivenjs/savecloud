//! Rutas de instalación elegidas manualmente cuando el escaneo automático no detecta el juego.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::store::inventory_dir;

const OVERRIDES_FILE: &str = "install_overrides.json";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct OverridesFile {
    #[serde(default)]
    roots: HashMap<String, String>,
}

fn overrides_path() -> Result<PathBuf, String> {
    Ok(inventory_dir()?.join(OVERRIDES_FILE))
}

pub fn load_install_overrides() -> Result<HashMap<String, String>, String> {
    let path = overrides_path()?;
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let file: OverridesFile =
        serde_json::from_slice(&bytes).map_err(|e| format!("overrides inválidos: {e}"))?;
    Ok(file.roots)
}

pub fn manual_install_root(game_key: &str) -> Option<PathBuf> {
    let key = game_key.trim();
    if key.is_empty() {
        return None;
    }
    let roots = load_install_overrides().ok()?;
    let path = roots.get(key)?;
    let pb = PathBuf::from(path);
    if pb.is_dir() {
        Some(pb)
    } else {
        None
    }
}

pub fn set_manual_install_root(game_key: &str, folder: &Path) -> Result<(), String> {
    let key = game_key.trim();
    if key.is_empty() {
        return Err("gameKey vacío".to_string());
    }
    if !folder.is_dir() {
        return Err("La carpeta no existe o no es un directorio".to_string());
    }

    let mut roots = load_install_overrides()?;
    roots.insert(key.to_string(), folder.to_string_lossy().into_owned());

    let path = overrides_path()?;
    let payload = serde_json::to_vec_pretty(&OverridesFile { roots }).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &payload).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)]
pub fn remove_manual_install_root(game_key: &str) -> Result<(), String> {
    let key = game_key.trim();
    let mut roots = load_install_overrides()?;
    if roots.remove(key).is_none() {
        return Ok(());
    }
    let path = overrides_path()?;
    let payload = serde_json::to_vec_pretty(&OverridesFile { roots }).map_err(|e| e.to_string())?;
    fs::write(&path, &payload).map_err(|e| e.to_string())?;
    Ok(())
}
