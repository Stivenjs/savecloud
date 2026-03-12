//! Lógica de rutas y lectura del archivo de configuración.
//! Compatible con la ubicación usada por el CLI.

use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const CONFIG_DIR_NAME: &str = "sync-games";
pub const CONFIG_FILE_NAME: &str = "config.json";

/// Directorio de configuración según la plataforma.
/// Windows: %APPDATA%/sync-games
/// macOS: ~/Library/Application Support/sync-games
/// Linux: ~/.config/sync-games
pub fn config_dir() -> Option<PathBuf> {
    let base = dirs::config_dir()
        .or_else(|| dirs::data_local_dir())
        .or_else(dirs::home_dir)?;
    Some(base.join(CONFIG_DIR_NAME))
}

/// Ruta completa al archivo config.json.
pub fn config_path() -> Option<PathBuf> {
    config_dir().map(|d| d.join(CONFIG_FILE_NAME))
}

/// Estructura mínima para deserializar el config del CLI.
#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub api_base_url: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub user_id: Option<String>,
    #[serde(default)]
    pub games: Vec<ConfiguredGame>,
    #[serde(default)]
    pub custom_scan_paths: Vec<String>,
    /// Cuántos backups locales mantener por juego (auto-limpieza y valor por defecto en la UI). Si no está definido, se usa 10.
    #[serde(default)]
    pub keep_backups_per_game: Option<u32>,
    /// Feature flag: backup completo (tar) en modo streaming (sin escribir .tar a disco).
    /// Experimental. Si no está definido, se considera false.
    #[serde(default)]
    pub full_backup_streaming: Option<bool>,
    /// Modo prueba: usa streaming pero sin subir a la nube (no llama a la API ni S3).
    /// Útil para medir rendimiento sin coste.
    #[serde(default)]
    pub full_backup_streaming_dry_run: Option<bool>,
    #[serde(default)]
    pub operation_history: Vec<OperationLogEntry>,
}

#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredGame {
    pub id: String,
    #[serde(default)]
    pub paths: Vec<String>,
    /// Steam App ID: si está definido, se usa la imagen del CDN de Steam.
    #[serde(default)]
    pub steam_app_id: Option<String>,
    /// URL personalizada de imagen. Prioridad sobre steam_app_id. Para juegos no-Steam.
    #[serde(default)]
    pub image_url: Option<String>,
    /// Nombres de ejecutable para detectar si el juego está en ejecución (ej. ["eldenring.exe"]).
    #[serde(default)]
    pub executable_names: Option<Vec<String>>,
    /// Etiqueta de origen/edición (ej. Steam, Empress, RUNE). Solo informativa.
    #[serde(default)]
    pub edition_label: Option<String>,
    /// URL de descarga o página de la edición (ej. enlace al release).
    #[serde(default)]
    pub source_url: Option<String>,
    /// Magnet link o ruta a archivo .torrent para descargar contenido del juego.
    #[serde(default)]
    pub magnet_link: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationLogEntry {
    pub timestamp: String,
    pub kind: String,
    pub game_id: String,
    pub file_count: u32,
    pub err_count: u32,
}

/// Añade una entrada al historial de operaciones y persiste el config.
pub fn append_operation_log(
    kind: &str,
    game_id: &str,
    file_count: u32,
    err_count: u32,
) -> Result<(), String> {
    let mut cfg = load_config();
    let entry = OperationLogEntry {
        timestamp: Utc::now().to_rfc3339(),
        kind: kind.to_string(),
        game_id: game_id.to_string(),
        file_count,
        err_count,
    };
    cfg.operation_history.push(entry);

    // Limitar a las últimas N entradas para no crecer indefinidamente.
    const MAX_ENTRIES: usize = 200;
    if cfg.operation_history.len() > MAX_ENTRIES {
        let drop = cfg.operation_history.len() - MAX_ENTRIES;
        cfg.operation_history.drain(0..drop);
    }

    save_config(&cfg)
}

/// Lee el archivo de config desde disco.
/// Usa SYNC_GAMES_API_URL y SYNC_GAMES_API_KEY de .env como defaults si no están en el config
/// (igual que la CLI).
pub fn load_config() -> Config {
    let path = match config_path() {
        Some(p) => p,
        None => return config_with_env_defaults(Config::default()),
    };

    let contents = match fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return config_with_env_defaults(Config::default()),
    };

    let cfg: Config = serde_json::from_str(&contents).unwrap_or_default();
    config_with_env_defaults(cfg)
}

/// Aplica defaults: las variables de entorno tienen prioridad sobre config.json
/// (si SYNC_GAMES_API_URL / SYNC_GAMES_API_KEY / SYNC_GAMES_USER_ID están definidas, se usan).
/// Si no hay env, se usa el valor del archivo o vacío.
fn config_with_env_defaults(mut cfg: Config) -> Config {
    if cfg.api_base_url.is_none() || cfg.api_base_url.as_deref().unwrap_or_default().is_empty() {
        let url = option_env!("SYNC_GAMES_API_URL")
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(String::from)
            .or_else(|| {
                std::env::var("SYNC_GAMES_API_URL")
                    .ok()
                    .filter(|s| !s.trim().is_empty())
            });
        if let Some(u) = url {
            cfg.api_base_url = Some(u);
        }
    }

    if cfg.api_key.is_none() || cfg.api_key.as_deref().unwrap_or_default().is_empty() {
        let key = option_env!("SYNC_GAMES_API_KEY")
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(String::from)
            .or_else(|| {
                std::env::var("SYNC_GAMES_API_KEY")
                    .ok()
                    .filter(|s| !s.trim().is_empty())
            });
        if let Some(k) = key {
            cfg.api_key = Some(k);
        }
    }

    if cfg.user_id.is_none() || cfg.user_id.as_deref().unwrap_or_default().is_empty() {
        let uid = option_env!("SYNC_GAMES_USER_ID")
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(String::from)
            .or_else(|| {
                std::env::var("SYNC_GAMES_USER_ID")
                    .ok()
                    .filter(|s| !s.trim().is_empty())
            });
        if let Some(u) = uid {
            cfg.user_id = Some(u);
        }
    }

    cfg
}

/// Guarda el config en disco.
/// Usada por commands::add_game y commands::remove_game.
#[allow(dead_code)]
pub fn save_config(cfg: &Config) -> Result<(), String> {
    let path = config_path().ok_or_else(|| "No config path".to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}
