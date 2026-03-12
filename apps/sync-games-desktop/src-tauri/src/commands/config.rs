//! Comandos relacionados con la configuración.

use std::fs;
use std::path::Path;

use crate::config;
use crate::steam;
use base64::Engine;
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDto {
    pub api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub user_id: Option<String>,
    pub games: Vec<GameDto>,
    pub custom_scan_paths: Vec<String>,
    pub keep_backups_per_game: Option<u32>,
    pub full_backup_streaming: Option<bool>,
    pub full_backup_streaming_dry_run: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDto {
    pub id: String,
    pub paths: Vec<String>,
    pub steam_app_id: Option<String>,
    pub image_url: Option<String>,
    pub edition_label: Option<String>,
    pub source_url: Option<String>,
    pub magnet_link: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationLogEntryDto {
    pub timestamp: String,
    pub kind: String,
    pub game_id: String,
    pub file_count: u32,
    pub err_count: u32,
}

#[tauri::command]
pub fn get_config() -> ConfigDto {
    let cfg = config::load_config();
    ConfigDto {
        api_base_url: cfg.api_base_url,
        api_key: cfg.api_key,
        user_id: cfg.user_id,
        games: cfg
            .games
            .into_iter()
            .map(|g| {
                let steam_app_id = g.steam_app_id.clone().or_else(|| {
                    if g.image_url.is_none() {
                        steam::resolve_app_id_for_game(&g.paths)
                    } else {
                        None
                    }
                });
                GameDto {
                    id: g.id,
                    paths: g.paths,
                    steam_app_id,
                    image_url: g.image_url,
                    edition_label: g.edition_label,
                    source_url: g.source_url,
                    magnet_link: g.magnet_link,
                }
            })
            .collect(),
        custom_scan_paths: cfg.custom_scan_paths,
        keep_backups_per_game: cfg.keep_backups_per_game,
        full_backup_streaming: cfg.full_backup_streaming,
        full_backup_streaming_dry_run: cfg.full_backup_streaming_dry_run,
    }
}

#[tauri::command]
pub fn get_config_path() -> String {
    config::config_path()
        .and_then(|p| p.into_os_string().into_string().ok())
        .unwrap_or_else(|| "".to_string())
}

/// Devuelve el historial de operaciones (subidas, descargas, copias de amigos).
#[tauri::command]
pub fn list_operation_history() -> Vec<OperationLogEntryDto> {
    let cfg = config::load_config();
    cfg.operation_history
        .into_iter()
        .map(|e| OperationLogEntryDto {
            timestamp: e.timestamp,
            kind: e.kind,
            game_id: e.game_id,
            file_count: e.file_count,
            err_count: e.err_count,
        })
        .collect()
}

/// Crea o actualiza el archivo de configuración con los datos indicados.
/// Si el archivo ya existe, actualiza solo api_base_url, api_key y user_id (mantiene games y custom_scan_paths).
#[tauri::command]
pub fn create_config_file(
    api_base_url: Option<String>,
    api_key: Option<String>,
    user_id: Option<String>,
) -> Result<String, String> {
    let path = config::config_path().ok_or_else(|| "No config path".to_string())?;
    let path_str = path
        .clone()
        .into_os_string()
        .into_string()
        .unwrap_or_default();

    let mut cfg = if path.exists() {
        config::load_config()
    } else {
        config::Config::default()
    };

    if let Some(s) = api_base_url {
        let t = s.trim().to_string();
        cfg.api_base_url = if t.is_empty() { None } else { Some(t) };
    }
    if let Some(s) = api_key {
        let t = s.trim().to_string();
        cfg.api_key = if t.is_empty() { None } else { Some(t) };
    }
    if let Some(s) = user_id {
        let t = s.trim().to_string();
        cfg.user_id = if t.is_empty() { None } else { Some(t) };
    }

    config::save_config(&cfg)?;
    Ok(path_str)
}

/// Guarda en config cuántos backups locales mantener por juego (usado por la UI y por la auto-limpieza tras descargas).
#[tauri::command]
pub fn set_keep_backups_per_game(keep_last_n: u32) -> Result<(), String> {
    let mut cfg = config::load_config();
    cfg.keep_backups_per_game = Some(keep_last_n);
    config::save_config(&cfg)
}

/// Feature flag (experimental): activa/desactiva el backup completo en modo streaming (sin .tar temporal).
#[tauri::command]
pub fn set_full_backup_streaming(enabled: bool) -> Result<(), String> {
    let mut cfg = config::load_config();
    cfg.full_backup_streaming = Some(enabled);
    config::save_config(&cfg)
}

/// Modo prueba para backup streaming: no sube a la nube, solo genera el TAR en streaming y mide rendimiento.
#[tauri::command]
pub fn set_full_backup_streaming_dry_run(enabled: bool) -> Result<(), String> {
    let mut cfg = config::load_config();
    cfg.full_backup_streaming_dry_run = Some(enabled);
    config::save_config(&cfg)
}

#[tauri::command]
pub fn add_game(
    game_id: String,
    path: String,
    edition_label: Option<String>,
    source_url: Option<String>,
    steam_app_id: Option<String>,
    image_url: Option<String>,
) -> Result<(), String> {
    let mut cfg = config::load_config();
    let game_id = game_id.trim().to_string();
    let path = path.trim().to_string();

    if game_id.is_empty() || path.is_empty() {
        return Err("gameId and path are required".to_string());
    }

    // Normalizar strings opcionales (trim y vacío -> None)
    let edition_label = edition_label
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let source_url = source_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let steam_app_id = steam_app_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let image_url = image_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(g) = cfg
        .games
        .iter_mut()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
    {
        if !g.paths.contains(&path) {
            g.paths.push(path);
        }
        if let Some(label) = edition_label {
            g.edition_label = Some(label);
        }
        if let Some(url) = source_url {
            g.source_url = Some(url);
        }
        if let Some(app_id) = steam_app_id {
            g.steam_app_id = Some(app_id);
        }
        if let Some(ref img) = image_url {
            g.image_url = Some(img.clone());
        }
    } else {
        cfg.games.push(config::ConfiguredGame {
            id: game_id,
            paths: vec![path],
            steam_app_id,
            image_url,
            executable_names: None,
            edition_label,
            source_url,
            magnet_link: None,
        });
    }

    config::save_config(&cfg)
}

/// Actualiza un juego existente: rutas y metadatos opcionales.
#[tauri::command]
pub fn update_game(
    game_id: String,
    paths: Vec<String>,
    edition_label: Option<String>,
    source_url: Option<String>,
    steam_app_id: Option<String>,
    image_url: Option<String>,
) -> Result<(), String> {
    let mut cfg = config::load_config();
    let game_id = game_id.trim();
    if game_id.is_empty() {
        return Err("gameId es obligatorio".to_string());
    }

    let paths: Vec<String> = paths
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if paths.is_empty() {
        return Err("Al menos una ruta es obligatoria".to_string());
    }

    let edition_label = edition_label
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let source_url = source_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let steam_app_id = steam_app_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let image_url = image_url
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let g = cfg
        .games
        .iter_mut()
        .find(|g| g.id.eq_ignore_ascii_case(game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    g.paths = paths;
    g.edition_label = edition_label;
    g.source_url = source_url;
    g.steam_app_id = steam_app_id;
    g.image_url = image_url;

    config::save_config(&cfg)
}

/// Renombra un juego en la configuración (cambia su id).
#[tauri::command]
pub fn rename_game(old_game_id: String, new_game_id: String) -> Result<(), String> {
    let mut cfg = config::load_config();
    let old_id = old_game_id.trim();
    let new_id = new_game_id.trim().to_string();
    if old_id.is_empty() || new_id.is_empty() {
        return Err("oldGameId y newGameId son obligatorios".to_string());
    }
    if old_id.eq_ignore_ascii_case(&new_id) {
        return Ok(());
    }
    if cfg.games.iter().any(|g| g.id.eq_ignore_ascii_case(&new_id)) {
        return Err(format!(
            "Ya existe un juego con el id \"{}\". Elige otro nombre.",
            new_id
        ));
    }
    let g = cfg
        .games
        .iter_mut()
        .find(|g| g.id.eq_ignore_ascii_case(old_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", old_id))?;
    g.id = new_id;
    config::save_config(&cfg)
}

/// Tamaño máximo para imagen local (2 MiB) para no hinchar el config.
const MAX_IMAGE_BYTES: u64 = 2 * 1024 * 1024;

/// Lee un archivo de imagen y lo devuelve como data URL (base64).
/// Útil para portadas personalizadas de juegos no-Steam o emuladores.
#[tauri::command]
pub fn read_image_as_data_url(path: String) -> Result<String, String> {
    let path = Path::new(path.trim());
    if !path.exists() {
        return Err("El archivo no existe".to_string());
    }
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "La imagen no puede superar {} MB.",
            MAX_IMAGE_BYTES / (1024 * 1024)
        ));
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
pub fn remove_game(game_id: String, path: Option<String>) -> Result<(), String> {
    let mut cfg = config::load_config();
    let game_id = game_id.trim();
    let path = path.as_deref().map(|s| s.trim());

    let idx = cfg
        .games
        .iter()
        .position(|g| g.id.eq_ignore_ascii_case(game_id));
    let Some(idx) = idx else {
        return Err(format!("Juego no encontrado: {}", game_id));
    };

    if let Some(p) = path {
        cfg.games[idx].paths.retain(|x| x != p);
        if cfg.games[idx].paths.is_empty() {
            cfg.games.remove(idx);
        }
    } else {
        cfg.games.remove(idx);
    }

    config::save_config(&cfg)
}
