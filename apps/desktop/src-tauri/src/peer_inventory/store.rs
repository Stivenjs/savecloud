//! Persistencia local del manifiesto de inventario.

use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use serde_json;

use super::models::DeviceInventoryManifest;

const LOCAL_MANIFEST_FILE: &str = "local.json";

fn local_manifest_path() -> Result<PathBuf, String> {
    let subpath = format!("peer_inventory/{LOCAL_MANIFEST_FILE}");
    let path = crate::config::profile_storage::scoped_or_legacy_path(&subpath)
        .ok_or_else(|| "No se pudo resolver local_manifest_path".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

pub fn inventory_dir() -> Result<PathBuf, String> {
    let path = local_manifest_path()?;
    let parent = path
        .parent()
        .ok_or_else(|| "Sin directorio de inventario".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    Ok(parent.to_path_buf())
}

pub fn load_local_manifest() -> Result<Option<DeviceInventoryManifest>, String> {
    let path = local_manifest_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;
    let manifest: DeviceInventoryManifest =
        serde_json::from_slice(&bytes).map_err(|e| format!("Manifiesto local inválido: {e}"))?;
    Ok(Some(manifest))
}

pub fn save_local_manifest(manifest: &DeviceInventoryManifest) -> Result<(), String> {
    let path = local_manifest_path()?;
    let payload = serde_json::to_vec_pretty(manifest).map_err(|e| format!("Serialización: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, &payload).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

pub fn resolve_device_name() -> String {
    let name = gethostname::gethostname()
        .to_string_lossy()
        .trim()
        .to_string();
    if name.is_empty() {
        "SaveCloud-PC".to_string()
    } else {
        name
    }
}

pub fn resolve_device_id() -> Result<String, String> {
    let db = crate::sqlite::AppDb::open().map_err(|e| e.to_string())?;
    crate::notifications::db::get_or_create_device_id(&db).map_err(|e| e.to_string())
}
