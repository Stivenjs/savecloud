//! Resolución segura de rutas en el sistema de archivos local.

use std::path::PathBuf;

pub const CONFIG_DIR_NAME: &str = "SaveCloud";
pub const DATA_DIR_NAME: &str = "data";

pub const SETTINGS_FILE_NAME: &str = "settings.json";
pub const LIBRARY_FILE_NAME: &str = "library.json";
pub const HISTORY_FILE_NAME: &str = "history.json";
pub const GAMIFICATION_FILE_NAME: &str = "gamification.json";
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
        .or_else(|| dirs::data_local_dir())
        .or_else(dirs::home_dir)?;
    Some(base.join(CONFIG_DIR_NAME))
}

/// Obtiene el subdirectorio destinado a la persistencia de datos estructurados.
pub fn data_dir() -> Option<PathBuf> {
    config_dir().map(|d| d.join(DATA_DIR_NAME))
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

/// Base de datos SQLite del catálogo Steam (lista local + metadatos enriquecidos).
pub fn sqlite_catalog_path() -> Option<PathBuf> {
    data_dir().map(|d| d.join(SQLITE_CATALOG_DB_NAME))
}
