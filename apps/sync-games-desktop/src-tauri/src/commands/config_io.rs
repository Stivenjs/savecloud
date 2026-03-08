//! Exportar e importar configuración (lista de juegos) a/desde JSON.

use crate::commands::config::{ConfigDto, GameDto};
use crate::commands::sync::api::{
    api_request, log_transfer_endpoint, sync_list_remote_saves, sync_list_remote_saves_for_user,
};
use crate::config;
use chrono::Utc;
use regex::Regex;
use std::fs;
use std::path::PathBuf;

fn expand_path(raw: &str) -> Option<PathBuf> {
    let mut result = raw.to_string();
    let re = Regex::new(r"%([^%]+)%").ok()?;
    for cap in re.captures_iter(raw) {
        let var = cap.get(1)?.as_str();
        let val = std::env::var(var).unwrap_or_default();
        result = result.replace(&format!("%{}%", var), &val);
    }
    if result.starts_with('~') {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        if !home.is_empty() {
            let rest = result.trim_start_matches('~').trim_start_matches('/');
            result = if rest.is_empty() {
                home
            } else {
                format!("{}/{}", home.trim_end_matches(&['/', '\\']), rest)
            };
        }
    }
    if result.is_empty() {
        None
    } else {
        Some(PathBuf::from(result))
    }
}

/// Devuelve la primera ruta expandida del juego (para abrir en explorador).
#[tauri::command]
pub fn get_game_save_path(game_id: String) -> Result<String, String> {
    let cfg = config::load_config();
    let game = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;

    let first = game
        .paths
        .first()
        .ok_or("El juego no tiene rutas configuradas")?;
    expand_path(first.trim())
        .ok_or("No se pudo expandir la ruta")?
        .into_os_string()
        .into_string()
        .map_err(|_| "Ruta no válida".to_string())
}

#[tauri::command]
pub fn open_save_folder(game_id: String) -> Result<(), String> {
    let path = get_game_save_path(game_id)?;
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Exporta la configuración a un archivo JSON. Devuelve el path escrito.
#[tauri::command]
pub fn export_config_to_file(path: String) -> Result<String, String> {
    let cfg = config::load_config();
    let json = serde_json::to_string_pretty(&cfg).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Sube el archivo de configuración local a la nube como "__config__/config.json".
#[tauri::command]
pub async fn backup_config_to_cloud() -> Result<(), String> {
    let cfg = config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    let path = config::config_path().ok_or("No se encontró ruta de config")?;
    let bytes = fs::read(&path).map_err(|e| e.to_string())?;

    // 1. Obtener URL de subida
    let body = serde_json::json!({
        "gameId": "__config__",
        "filename": "config.json"
    });
    let res = api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/upload-url",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| format!("upload-url: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API: {} {}", status, text));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let upload_url = json
        .get("uploadUrl")
        .and_then(|v| v.as_str())
        .ok_or("API no devolvió uploadUrl")?;
    log_transfer_endpoint("Subida (config)", upload_url);

    // 2. Subir config.json a S3
    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let content_length = bytes.len();
    let put_res = client
        .put(upload_url)
        .body(bytes)
        .header("Content-Type", "application/json")
        .header("Content-Length", content_length.to_string())
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !put_res.status().is_success() {
        return Err(format!("S3 PUT: {}", put_res.status()));
    }

    Ok(())
}

/// Descarga la copia más reciente de "__config__/config.json" y la guarda localmente.
#[tauri::command]
pub async fn restore_config_from_cloud() -> Result<(), String> {
    let cfg = config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    let saves = sync_list_remote_saves().await?;
    let mut config_saves: Vec<_> = saves
        .into_iter()
        .filter(|s| s.game_id == "__config__" && s.filename.ends_with("config.json"))
        .collect();

    if config_saves.is_empty() {
        return Err("No se encontró configuración en la nube".into());
    }

    // Ordenar por last_modified y quedarnos con el más reciente
    config_saves.sort_by(|a, b| a.last_modified.cmp(&b.last_modified));

    let latest = config_saves.pop().unwrap();

    // Pedir URL de descarga
    let body = serde_json::json!({
        "gameId": "__config__",
        "key": latest.key
    });
    let res = api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/download-url",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| format!("download-url: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("API: {}", res.status()));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let download_url = json
        .get("downloadUrl")
        .and_then(|v| v.as_str())
        .ok_or("API no devolvió downloadUrl")?;
    log_transfer_endpoint("Descarga (config)", download_url);

    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let bytes = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    // Validar que es un JSON de config válido antes de sobrescribir
    let imported: config::Config =
        serde_json::from_slice(&bytes).map_err(|e| format!("JSON inválido: {}", e))?;

    // Guardar backup local antes de sobrescribir
    if let Some(path) = config::config_path() {
        if path.exists() {
            if let Some(parent) = path.parent() {
                let backup_dir = parent.join("config-backups");
                let _ = fs::create_dir_all(&backup_dir);
                let ts = Utc::now().format("%Y-%m-%d_%H-%M-%S");
                let backup_path = backup_dir.join(format!("config-{}.json", ts));
                let _ = fs::write(&backup_path, fs::read(&path).unwrap_or_default());
            }
        }
    }

    config::save_config(&imported)
}

/// Obtiene la configuración de un amigo (desde la nube) sin sobrescribir la local.
#[tauri::command]
pub async fn get_friend_config(friend_user_id: String) -> Result<ConfigDto, String> {
    let friend_id = friend_user_id.trim();
    if friend_id.is_empty() {
        return Err("friendUserId vacío".into());
    }

    let cfg = config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    // Buscar el último config.json del amigo
    let saves = sync_list_remote_saves_for_user(friend_id.to_string()).await?;
    let mut config_saves: Vec<_> = saves
        .into_iter()
        .filter(|s| s.game_id == "__config__" && s.filename.ends_with("config.json"))
        .collect();

    if config_saves.is_empty() {
        return Err("El amigo no tiene configuración respaldada en la nube".into());
    }

    config_saves.sort_by(|a, b| a.last_modified.cmp(&b.last_modified));
    let latest = config_saves.pop().unwrap();

    // Pedir URL de descarga para el config del amigo
    let body = serde_json::json!({
        "gameId": "__config__",
        "key": latest.key
    });
    let res = api_request(
        api_base,
        friend_id,
        api_key,
        "POST",
        "/download-url",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| format!("download-url: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("API: {}", res.status()));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let download_url = json
        .get("downloadUrl")
        .and_then(|v| v.as_str())
        .ok_or("API no devolvió downloadUrl")?;
    log_transfer_endpoint("Descarga (config)", download_url);

    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let bytes = client
        .get(download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    let imported: config::Config =
        serde_json::from_slice(&bytes).map_err(|e| format!("JSON inválido: {}", e))?;

    // Mapear a ConfigDto compatible con el frontend
    let games = imported
        .games
        .into_iter()
        .map(|g| GameDto {
            id: g.id,
            paths: g.paths,
            steam_app_id: g.steam_app_id,
            image_url: g.image_url,
            edition_label: g.edition_label,
            source_url: g.source_url,
        })
        .collect();

    Ok(ConfigDto {
        api_base_url: None,
        api_key: None,
        user_id: imported.user_id.or_else(|| Some(friend_id.to_string())),
        games,
        custom_scan_paths: imported.custom_scan_paths,
        keep_backups_per_game: None,
    })
}

/// Añade a la config local solo los juegos del amigo que aún no tenemos (por id).
/// No modifica api_key ni user_id. Las rutas del amigo se copian como referencia; el usuario puede editarlas después.
#[tauri::command]
pub fn add_games_from_friend(friend_games: Vec<GameDto>) -> Result<usize, String> {
    let mut cfg = config::load_config();
    let mut existing_ids: std::collections::HashSet<String> =
        cfg.games.iter().map(|g| g.id.to_lowercase()).collect();
    const PLACEHOLDER_PATH: &str = "(editar ruta en Configuración)";
    let mut added = 0usize;
    for g in friend_games {
        if g.id.trim().is_empty() {
            continue;
        }
        if existing_ids.contains(&g.id.to_lowercase()) {
            continue;
        }
        let paths: Vec<String> = if g.paths.is_empty() {
            vec![PLACEHOLDER_PATH.to_string()]
        } else {
            g.paths
        };
        let id_lower = g.id.trim().to_lowercase();
        cfg.games.push(config::ConfiguredGame {
            id: g.id.trim().to_string(),
            paths,
            steam_app_id: g.steam_app_id,
            image_url: g.image_url,
            executable_names: None,
            edition_label: g.edition_label,
            source_url: g.source_url,
        });
        existing_ids.insert(id_lower);
        added += 1;
    }
    if added > 0 {
        config::save_config(&cfg)?;
    }
    Ok(added)
}

/// Importa configuración desde archivo. mode: "merge" fusiona juegos, "replace" reemplaza todo.
#[tauri::command]
pub fn import_config_from_file(path: String, mode: String) -> Result<(), String> {
    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let imported: config::Config =
        serde_json::from_str(&contents).map_err(|e| format!("JSON inválido: {}", e))?;

    let mut cfg = config::load_config();

    match mode.as_str() {
        "replace" => {
            cfg = imported;
        }
        "merge" => {
            for imp_game in imported.games {
                if let Some(existing) = cfg
                    .games
                    .iter_mut()
                    .find(|g| g.id.eq_ignore_ascii_case(&imp_game.id))
                {
                    for p in imp_game.paths {
                        if !existing.paths.contains(&p) {
                            existing.paths.push(p);
                        }
                    }
                    if imp_game.steam_app_id.is_some() && existing.steam_app_id.is_none() {
                        existing.steam_app_id = imp_game.steam_app_id;
                    }
                    if imp_game.image_url.is_some() && existing.image_url.is_none() {
                        existing.image_url = imp_game.image_url;
                    }
                } else {
                    cfg.games.push(imp_game);
                }
            }
            for cp in imported.custom_scan_paths {
                if !cfg.custom_scan_paths.contains(&cp) {
                    cfg.custom_scan_paths.push(cp);
                }
            }
        }
        _ => return Err("mode debe ser 'merge' o 'replace'".to_string()),
    }

    config::save_config(&cfg)
}
