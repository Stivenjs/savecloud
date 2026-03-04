//! Comandos relacionados con la configuración.

use crate::config;
use crate::steam;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigDto {
    pub api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub user_id: Option<String>,
    pub games: Vec<GameDto>,
    pub custom_scan_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameDto {
    pub id: String,
    pub paths: Vec<String>,
    pub steam_app_id: Option<String>,
    pub image_url: Option<String>,
    pub edition_label: Option<String>,
    pub source_url: Option<String>,
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
                }
            })
            .collect(),
        custom_scan_paths: cfg.custom_scan_paths,
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

#[tauri::command]
pub fn add_game(
    game_id: String,
    path: String,
    edition_label: Option<String>,
    source_url: Option<String>,
    steam_app_id: Option<String>,
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
    } else {
        cfg.games.push(config::ConfiguredGame {
            id: game_id,
            paths: vec![path],
            steam_app_id,
            image_url: None,
            executable_names: None,
            edition_label,
            source_url,
        });
    }

    config::save_config(&cfg)
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
