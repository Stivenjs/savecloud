//! Gestión del layout de almacenamiento en disco.
//!
//! Este módulo garantiza la existencia de la estructura v2 y migra archivos
//! legacy desde `data/` hacia subdirectorios por dominio.

use super::paths;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const STORAGE_LAYOUT_VERSION: u32 = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageManifest {
    pub version: u32,
    pub created_at: String,
    pub last_migration: String,
}

impl StorageManifest {
    fn new() -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            version: STORAGE_LAYOUT_VERSION,
            created_at: now.clone(),
            last_migration: now,
        }
    }
}

pub fn ensure_storage_layout() -> Result<(), String> {
    ensure_directory(paths::data_dir().as_deref())?;
    ensure_directory(paths::core_dir().as_deref())?;
    ensure_directory(paths::db_dir().as_deref())?;
    ensure_directory(paths::runtime_dir().as_deref())?;
    ensure_directory(paths::cache_dir().as_deref())?;
    ensure_directory(paths::plugins_dir().as_deref())?;

    migrate_legacy_file(
        paths::legacy_profiles_index_path(),
        paths::profiles_index_path(),
        false,
    )?;
    migrate_legacy_file(paths::legacy_sources_path(), paths::sources_path(), false)?;
    migrate_legacy_file(
        paths::legacy_active_jobs_path(),
        paths::active_jobs_path(),
        false,
    )?;
    migrate_legacy_file(
        paths::legacy_sqlite_catalog_path(),
        paths::sqlite_catalog_path(),
        true,
    )?;

    let mut manifest = load_manifest().unwrap_or_else(StorageManifest::new);
    if manifest.version < STORAGE_LAYOUT_VERSION {
        manifest.version = STORAGE_LAYOUT_VERSION;
    }
    manifest.last_migration = Utc::now().to_rfc3339();
    save_manifest(&manifest)
}

fn ensure_directory(path: Option<&Path>) -> Result<(), String> {
    let Some(path) = path else {
        return Err("No se pudo resolver directorio de storage".to_string());
    };
    fs::create_dir_all(path).map_err(|error| error.to_string())
}

fn migrate_legacy_file(
    legacy_path: Option<PathBuf>,
    new_path: Option<PathBuf>,
    include_sqlite_sidecars: bool,
) -> Result<(), String> {
    let Some(new_path) = new_path else {
        return Ok(());
    };
    if new_path.exists() {
        return Ok(());
    }
    let Some(legacy_path) = legacy_path else {
        return Ok(());
    };
    if !legacy_path.exists() {
        return Ok(());
    }

    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    move_file_atomically(&legacy_path, &new_path)?;

    if include_sqlite_sidecars {
        migrate_sqlite_sidecar(&legacy_path, &new_path, "-wal")?;
        migrate_sqlite_sidecar(&legacy_path, &new_path, "-shm")?;
    }

    Ok(())
}

fn migrate_sqlite_sidecar(legacy_db: &Path, new_db: &Path, suffix: &str) -> Result<(), String> {
    let legacy = PathBuf::from(format!("{}{}", legacy_db.to_string_lossy(), suffix));
    let new_file = PathBuf::from(format!("{}{}", new_db.to_string_lossy(), suffix));
    if !legacy.exists() || new_file.exists() {
        return Ok(());
    }
    move_file_atomically(&legacy, &new_file)
}

fn move_file_atomically(from: &Path, to: &Path) -> Result<(), String> {
    #[cfg(windows)]
    if to.exists() {
        fs::remove_file(to).map_err(|error| error.to_string())?;
    }
    fs::rename(from, to).map_err(|error| error.to_string())
}

fn load_manifest() -> Option<StorageManifest> {
    let path = paths::storage_manifest_path()?;
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str::<StorageManifest>(&raw).ok()
}

fn save_manifest(manifest: &StorageManifest) -> Result<(), String> {
    let Some(path) = paths::storage_manifest_path() else {
        return Err("No se pudo resolver storage_manifest.json".to_string());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let payload = serde_json::to_string_pretty(manifest).map_err(|error| error.to_string())?;
    let temp = path.with_extension("json.tmp");
    fs::write(&temp, payload).map_err(|error| error.to_string())?;
    move_file_atomically(&temp, &path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_temp_dir(test_name: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        let stamp = Utc::now().timestamp_nanos_opt().unwrap_or_default();
        dir.push(format!("savecloud-storage-layout-{test_name}-{stamp}"));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn move_file_atomically_should_move_file_to_new_location() {
        let root = make_temp_dir("move-file");
        let source = root.join("legacy.json");
        let target = root.join("new").join("legacy.json");
        fs::write(&source, r#"{"hello":"world"}"#).expect("write source");
        fs::create_dir_all(target.parent().expect("parent")).expect("create parent");

        let result = move_file_atomically(&source, &target);

        assert!(result.is_ok());
        assert!(!source.exists());
        assert!(target.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn migrate_sqlite_sidecar_should_move_sidecar_when_present() {
        let root = make_temp_dir("sqlite-sidecar");
        let legacy_db = root.join("catalog.sqlite");
        let new_db = root.join("db").join("catalog.sqlite");
        fs::create_dir_all(new_db.parent().expect("parent")).expect("create parent");
        fs::write(format!("{}-wal", legacy_db.to_string_lossy()), "wal").expect("write wal");

        let result = migrate_sqlite_sidecar(&legacy_db, &new_db, "-wal");

        assert!(result.is_ok());
        assert!(PathBuf::from(format!("{}-wal", new_db.to_string_lossy())).exists());
        let _ = fs::remove_dir_all(root);
    }
}
