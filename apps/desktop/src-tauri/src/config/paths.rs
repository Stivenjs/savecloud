//! Resolución segura de rutas en el sistema de archivos local.

use std::path::PathBuf;

pub const CONFIG_DIR_NAME: &str = "SaveCloud";
pub const DATA_DIR_NAME: &str = "data";
pub const CORE_DIR_NAME: &str = "core";
pub const DB_DIR_NAME: &str = "db";
pub const RUNTIME_DIR_NAME: &str = "runtime";
pub const CACHE_DIR_NAME: &str = "cache";

pub const SETTINGS_FILE_NAME: &str = "settings.json";
pub const LIBRARY_FILE_NAME: &str = "library.json";
pub const HISTORY_FILE_NAME: &str = "history.json";
pub const GAMIFICATION_FILE_NAME: &str = "gamification.json";
pub const PROFILES_INDEX_FILE_NAME: &str = "profiles.json";
pub const STORAGE_MANIFEST_FILE_NAME: &str = "storage_manifest.json";
pub const SOURCES_FILE_NAME: &str = "sources.json";
pub const ACTIVE_JOBS_FILE_NAME: &str = "active_jobs.json";
pub const SQLITE_CATALOG_DB_NAME: &str = "catalog.sqlite";

/// Obtiene el directorio base de configuración de la aplicación.
///
/// El flujo es el siguiente:
/// 1. Intenta utilizar el directorio de configuración estándar del OS.
/// 2. Como respaldo, intenta utilizar el directorio de datos locales.
/// 3. Como último recurso, utiliza el directorio de usuario (HOME).
///
/// # Returns
///
/// Devuelve `Some(PathBuf)` con la ruta resuelta, o `None` si el sistema
/// operativo no provee una ruta válida.
pub fn config_dir() -> Option<PathBuf> {
    let base = dirs::config_dir()
        .or_else(dirs::data_local_dir)
        .or_else(dirs::home_dir)?;
    Some(base.join(CONFIG_DIR_NAME))
}

/// Obtiene el subdirectorio destinado a la persistencia de datos estructurados.
pub fn data_dir() -> Option<PathBuf> {
    config_dir().map(|d| d.join(DATA_DIR_NAME))
}

/// Directorio de metadatos críticos (manifiesto, índice de perfiles).
pub fn core_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join(CORE_DIR_NAME))
}

/// Directorio de la base de datos local.
pub fn db_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join(DB_DIR_NAME))
}

/// Directorio de estado efímero de runtime.
pub fn runtime_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join(RUNTIME_DIR_NAME))
}

/// Directorio de cache regenerable.
pub fn cache_dir() -> Option<PathBuf> {
    data_dir().map(|d| d.join(CACHE_DIR_NAME))
}

/// Ruta del manifiesto de storage versionado.
pub fn storage_manifest_path() -> Option<PathBuf> {
    core_dir().map(|d| d.join(STORAGE_MANIFEST_FILE_NAME))
}

/// Ruta del índice de perfiles en layout v2.
pub fn profiles_index_path() -> Option<PathBuf> {
    core_dir().map(|d| d.join(PROFILES_INDEX_FILE_NAME))
}

/// Ruta legado del índice de perfiles.
pub fn legacy_profiles_index_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join(PROFILES_INDEX_FILE_NAME))
}

/// Obtiene la ruta del archivo de configuración monolítico original.
/// Útil exclusivamente para fines de retrocompatibilidad o migraciones.
#[allow(dead_code)]
pub fn config_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join("config.json"))
}

/// Obtiene la ruta del archivo físico donde se almacenan las preferencias.
pub fn settings_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join(SETTINGS_FILE_NAME))
}

/// Obtiene la ruta del archivo físico donde se almacena la biblioteca de juegos.
pub fn library_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join(LIBRARY_FILE_NAME))
}

/// Obtiene la ruta del archivo físico donde se almacena el historial de operaciones.
pub fn history_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join(HISTORY_FILE_NAME))
}

/// Estado de gamificación local (también incluido en el JSON monolítico para nube/export).
pub fn gamification_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join(GAMIFICATION_FILE_NAME))
}

/// Ruta del catálogo de fuentes en cache.
pub fn sources_path() -> Option<PathBuf> {
    cache_dir().map(|d| d.join(SOURCES_FILE_NAME))
}

/// Ruta del estado de jobs activos en runtime.
pub fn active_jobs_path() -> Option<PathBuf> {
    runtime_dir().map(|d| d.join(ACTIVE_JOBS_FILE_NAME))
}

/// Ruta legado del catálogo de fuentes.
pub fn legacy_sources_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join(SOURCES_FILE_NAME))
}

/// Ruta legado de jobs activos.
pub fn legacy_active_jobs_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join(ACTIVE_JOBS_FILE_NAME))
}

/// Base de datos SQLite del catálogo Steam (lista local + metadatos enriquecidos).
pub fn sqlite_catalog_path() -> Option<PathBuf> {
    db_dir().map(|d| d.join(SQLITE_CATALOG_DB_NAME))
}

/// Ruta legado de la base SQLite principal.
pub fn legacy_sqlite_catalog_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join(SQLITE_CATALOG_DB_NAME))
}
