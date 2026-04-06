//! Comandos Tauri expuestos hacia el frontend de la aplicación.
//!
//! Contiene el mapeo de llamadas IPC responsables de la orquestación del
//! almacenamiento S3, importación/exportación de estado y manipulaciones
//! del árbol de juegos.

use crate::commands::sync::api::{api_request, get_download_urls, sync_list_remote_saves_for_user};
use crate::commands::sync::context::resolve_api_context;
use crate::config::gamification::GamificationStateDto;
use crate::config::{self, Config, ConfigDto, ConfiguredGame, GameDto, OperationLogEntryDto};
use crate::steam;
use crate::time;
use crate::utils::launch_exe;
use base64::Engine;
use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Resuelve interpolaciones del sistema y variables de entorno dentro de una ruta.
///
/// # Arguments
///
/// * `raw` - Ruta original conteniendo posibles variables (ej. `%APPDATA%` o `~`).
///
/// # Returns
///
/// Devuelve el `PathBuf` resuelto si la transformación resulta en una ruta válida.
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

/// Extrae y compone el objeto de configuración principal para ser entregado a la UI.
///
/// Resuelve de forma asíncrona la correspondencia de Steam App IDs para rellenar
/// metadatos de juegos faltantes sin bloquear la carga principal.
#[tauri::command]
pub fn get_config() -> ConfigDto {
    let combined = config::get_combined_config();
    let settings = config::load_settings();

    #[cfg(target_os = "windows")]
    let steam_map = steam::get_steam_path_to_appid_map();
    #[cfg(not(target_os = "windows"))]
    let steam_map = std::collections::HashMap::new();

    ConfigDto {
        api_base_url: combined.api_base_url,
        ws_base_url: combined.ws_base_url,
        api_key: combined.api_key.map(|_| config::MASKED_API_KEY.to_string()),
        user_id: combined.user_id,
        active_cloud_host_user_id: combined.active_cloud_host_user_id,
        cloud_host_ws_base_urls: combined.cloud_host_ws_base_urls,
        custom_scan_paths: combined.custom_scan_paths,
        keep_backups_per_game: combined.keep_backups_per_game,
        full_backup_streaming: combined.full_backup_streaming,
        full_backup_streaming_dry_run: combined.full_backup_streaming_dry_run,
        default_source_download_dir: combined.default_source_download_dir,
        total_playtime: time::get_total_playtime(),
        profile_background: settings.profile_background.clone(),
        profile_avatar: settings.profile_avatar.clone(),
        profile_frame: settings.profile_frame.clone(),
        steam_web_api_key: settings
            .steam_web_api_key
            .as_ref()
            .filter(|k| !k.trim().is_empty())
            .map(|_| config::MASKED_STEAM_WEB_API_KEY.to_string()),
        share_visual_profile_with_hosts: settings.share_visual_profile_with_hosts,
        share_visual_profile_with_members: settings.share_visual_profile_with_members,
        games: combined
            .games
            .into_iter()
            .map(|g| {
                let steam_app_id = g.steam_app_id.clone().or_else(|| {
                    if g.image_url.is_none() {
                        steam::resolve_app_id_for_game(&g.paths, &steam_map)
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
                    executable_names: g.executable_names.clone(),
                    launch_executable_path: g.launch_executable_path.clone(),
                    playtime_seconds: g.playtime_seconds,
                }
            })
            .collect(),
    }
}

/// Devuelve la ubicación absoluta del directorio de configuración de la app en disco.
#[tauri::command]
pub fn get_config_path() -> String {
    config::paths::data_dir()
        .and_then(|p| p.into_os_string().into_string().ok())
        .unwrap_or_default()
}

/// Expone el listado cronológico de operaciones históricas hacia el dashboard de la UI.
#[tauri::command]
pub fn list_operation_history() -> Vec<OperationLogEntryDto> {
    config::load_history()
        .entries
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

/// Establece las variables principales de entorno de red y usuario.
///
/// # Errors
///
/// Devuelve `Err` si la serialización falla o el SO deniega la escritura en disco.
#[tauri::command]
pub fn create_config_file(
    api_base_url: Option<String>,
    ws_base_url: Option<String>,
    api_key: Option<String>,
    user_id: Option<String>,
    steam_web_api_key: Option<String>,
) -> Result<String, String> {
    let mut settings = config::load_settings();

    if let Some(url) = api_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        settings.api_base_url = Some(url.to_string());
    }

    if let Some(url) = ws_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        settings.ws_base_url = Some(url.to_string());
    }

    if let Some(key) = api_key
        .as_deref()
        .map(str::trim)
        .filter(|k| *k != config::MASKED_API_KEY && !k.is_empty())
    {
        settings.api_key = Some(key.to_string());
    }

    if let Some(id) = user_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        settings.user_id = Some(id.to_string());
    }

    if let Some(key) = steam_web_api_key
        .as_deref()
        .map(str::trim)
        .filter(|k| *k != config::MASKED_STEAM_WEB_API_KEY && !k.is_empty())
    {
        settings.steam_web_api_key = Some(key.to_string());
    }

    config::save_settings(&settings)?;
    Ok(get_config_path())
}

#[tauri::command]
pub fn set_active_cloud_host_user_id(host_user_id: Option<String>) -> Result<(), String> {
    let mut settings = config::load_settings();
    settings.active_cloud_host_user_id = host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    config::save_settings(&settings)
}

#[tauri::command]
pub fn set_cloud_host_ws_url(host_user_id: String, ws_url: String) -> Result<(), String> {
    let mut settings = config::load_settings();
    let host = host_user_id.trim();
    let url = ws_url.trim();
    if !host.is_empty() && !url.is_empty() {
        settings
            .cloud_host_ws_base_urls
            .insert(host.to_string(), url.to_string());
        config::save_settings(&settings)?;
    }
    config::save_settings(&settings)
}

/// Modifica la política local de retención máxima de respaldos por juego.
#[tauri::command]
pub fn set_keep_backups_per_game(keep_last_n: u32) -> Result<(), String> {
    let mut settings = config::load_settings();
    settings.keep_backups_per_game = Some(keep_last_n);
    config::save_settings(&settings)
}

/// Activa o desactiva la compresión on-the-fly para el empaquetado TAR.
#[tauri::command]
pub fn set_full_backup_streaming(enabled: bool) -> Result<(), String> {
    let mut settings = config::load_settings();
    settings.full_backup_streaming = Some(enabled);
    config::save_settings(&settings)
}

/// Ajusta la configuración de ejecución de pruebas (Dry Run) de flujos.
#[tauri::command]
pub fn set_full_backup_streaming_dry_run(enabled: bool) -> Result<(), String> {
    let mut settings = config::load_settings();
    settings.full_backup_streaming_dry_run = Some(enabled);
    config::save_settings(&settings)
}

/// Lee la carpeta destino por defecto para descargas desde fuentes.
#[tauri::command]
pub fn get_default_source_download_dir() -> Option<String> {
    config::load_settings().default_source_download_dir
}

/// Guarda la carpeta destino por defecto para descargas desde fuentes.
#[tauri::command]
pub fn set_default_source_download_dir(path: Option<String>) -> Result<(), String> {
    let mut settings = config::load_settings();
    settings.default_source_download_dir = path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    config::save_settings(&settings)
}

/// Persiste la apariencia del perfil (fondo, avatar, marco). Cadenas vacías o `None` borran el valor.
#[tauri::command]
pub fn set_profile_appearance(
    profile_background: Option<String>,
    profile_avatar: Option<String>,
    profile_frame: Option<String>,
) -> Result<(), String> {
    fn norm(s: Option<String>) -> Option<String> {
        s.map(|x| x.trim().to_string()).filter(|x| !x.is_empty())
    }

    let mut settings = config::load_settings();
    settings.profile_background = norm(profile_background);
    settings.profile_avatar = norm(profile_avatar);
    settings.profile_frame = norm(profile_frame);
    config::save_settings(&settings)
}

/// Permite a los anfitriones de nubes compartidas ver avatar, fondo y marco al cargar tu perfil.
#[tauri::command]
pub fn set_share_visual_profile_with_hosts(enabled: bool) -> Result<(), String> {
    let mut settings = config::load_settings();
    settings.share_visual_profile_with_hosts = enabled;
    config::save_settings(&settings)
}

/// Permite a los miembros de tu nube ver avatar, fondo y marco al cargar tu perfil.
#[tauri::command]
pub fn set_share_visual_profile_with_members(enabled: bool) -> Result<(), String> {
    let mut settings = config::load_settings();
    settings.share_visual_profile_with_members = enabled;
    config::save_settings(&settings)
}

/// Registra un nuevo juego dentro del manifiesto local.
///
/// Agrupa rutas de guardado bajo un único identificador lógico, ignorando la
/// petición de duplicidad si el ID ya existe, pero adjuntando la ruta si esta es nueva.
///
/// # Errors
///
/// Devuelve `Err` si el ID proporcionado o la ruta enviada desde UI son nulas.
#[tauri::command]
pub fn add_game(
    game_id: String,
    path: String,
    edition_label: Option<String>,
    source_url: Option<String>,
    steam_app_id: Option<String>,
    image_url: Option<String>,
) -> Result<(), String> {
    let mut library = config::load_library();
    let game_id = game_id.trim().to_string();
    let path = path.trim().to_string();

    if game_id.is_empty() || path.is_empty() {
        return Err("Identificador o ruta ausente".to_string());
    }

    let trim_opt =
        |opt: Option<String>| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());

    if let Some(g) = library
        .games
        .iter_mut()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
    {
        if !g.paths.contains(&path) {
            g.paths.push(path);
        }
        if let Some(label) = trim_opt(edition_label) {
            g.edition_label = Some(label);
        }
        if let Some(url) = trim_opt(source_url) {
            g.source_url = Some(url);
        }
        if let Some(app_id) = trim_opt(steam_app_id) {
            g.steam_app_id = Some(app_id);
        }
        if let Some(img) = trim_opt(image_url) {
            g.image_url = Some(img);
        }
    } else {
        library.games.push(ConfiguredGame {
            id: game_id,
            paths: vec![path],
            steam_app_id: trim_opt(steam_app_id),
            image_url: trim_opt(image_url),
            executable_names: None,
            edition_label: trim_opt(edition_label),
            source_url: trim_opt(source_url),
            magnet_link: None,
            launch_executable_path: None,
            playtime_seconds: 0,
        });
    }
    config::save_library(&library)
}

/// Transacciona metadatos de un nodo de juego preexistente.
///
/// # Errors
///
/// Devuelve `Err` si el identificador lógico provisto no coincide con la base local.
#[tauri::command]
pub fn update_game(
    game_id: String,
    paths: Vec<String>,
    edition_label: Option<String>,
    source_url: Option<String>,
    steam_app_id: Option<String>,
    image_url: Option<String>,
) -> Result<(), String> {
    let mut library = config::load_library();
    let game_id = game_id.trim();
    if game_id.is_empty() {
        return Err("Requiere un identificador de juego".to_string());
    }

    let paths: Vec<String> = paths
        .into_iter()
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect();
    if paths.is_empty() {
        return Err("Se requiere al menos un vector de ruta".to_string());
    }

    let trim_opt =
        |opt: Option<String>| opt.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let g = library
        .games
        .iter_mut()
        .find(|g| g.id.eq_ignore_ascii_case(game_id))
        .ok_or_else(|| format!("Nodo huérfano: {}", game_id))?;

    g.paths = paths;
    g.edition_label = trim_opt(edition_label);
    g.source_url = trim_opt(source_url);
    g.steam_app_id = trim_opt(steam_app_id);
    g.image_url = trim_opt(image_url);

    config::save_library(&library)
}

/// Altera el identificador lógico de una entidad de guardado.
#[tauri::command]
pub fn rename_game(old_game_id: String, new_game_id: String) -> Result<(), String> {
    let mut library = config::load_library();
    let old_id = old_game_id.trim();
    let new_id = new_game_id.trim().to_string();

    if old_id.is_empty() || new_id.is_empty() {
        return Err("Requiere argumentos mutables plenos".to_string());
    }
    if old_id == new_id {
        return Ok(());
    }
    if library
        .games
        .iter()
        .any(|g| g.id.eq_ignore_ascii_case(&new_id) && !g.id.eq_ignore_ascii_case(old_id))
    {
        return Err(format!("Colisión de clave primaria '{}'", new_id));
    }

    let g = library
        .games
        .iter_mut()
        .find(|g| g.id.eq_ignore_ascii_case(old_id))
        .ok_or_else(|| format!("No localizable: {}", old_id))?;
    g.id = new_id;
    config::save_library(&library)
}

/// Elimina un nodo de la biblioteca o expulsa una ruta de su lista de monitoreo.
#[tauri::command]
pub fn remove_game(game_id: String, path: Option<String>) -> Result<(), String> {
    let mut library = config::load_library();
    let game_id = game_id.trim();
    let path = path.as_deref().map(|s| s.trim());

    let idx = library
        .games
        .iter()
        .position(|g| g.id.eq_ignore_ascii_case(game_id))
        .ok_or_else(|| format!("Nodo ausente: {}", game_id))?;

    if let Some(p) = path {
        library.games[idx].paths.retain(|x| x != p);
        if library.games[idx].paths.is_empty() {
            library.games.remove(idx);
        }
    } else {
        library.games.remove(idx);
    }

    config::save_library(&library)
}

/// Lista ejecutables de procesos en ejecución (nombres únicos, ordenados) para el selector manual.
#[tauri::command]
pub fn list_running_process_exe_names() -> Vec<String> {
    crate::system::process_check::list_running_process_exe_names()
}

/// Inicia el ejecutable configurado para este juego (ruta absoluta guardada en config).
#[tauri::command]
pub fn launch_game(game_id: String) -> Result<(), String> {
    let library = config::load_library();
    let game_id = game_id.trim();
    let game = library
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(game_id))
        .ok_or_else(|| "Juego no encontrado".to_string())?;
    let path = game
        .launch_executable_path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Configura primero el ejecutable del juego".to_string())?;
    if !Path::new(path).is_file() {
        return Err(format!("El archivo no existe: {}", path));
    }
    launch_exe::launch_game_executable(path)
}

/// Guarda la ruta al .exe para abrir el juego desde la app (`None` o cadena vacía borra la ruta).
#[tauri::command]
pub fn set_game_launch_executable(game_id: String, path: Option<String>) -> Result<(), String> {
    let mut library = config::load_library();
    let game_id = game_id.trim();
    let g = library
        .games
        .iter_mut()
        .find(|g| g.id.eq_ignore_ascii_case(game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;
    g.launch_executable_path = path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    config::save_library(&library)
}

/// Fija los nombres de proceso usados para detectar si el juego está en ejecución.
/// Lista vacía restaura la detección automática por nombre del juego.
#[tauri::command]
pub fn set_game_executable_names(game_id: String, names: Vec<String>) -> Result<(), String> {
    let mut library = config::load_library();
    let game_id = game_id.trim();
    let g = library
        .games
        .iter_mut()
        .find(|g| g.id.eq_ignore_ascii_case(game_id))
        .ok_or_else(|| format!("Juego no encontrado: {}", game_id))?;
    let filtered: Vec<String> = names
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    g.executable_names = if filtered.is_empty() {
        None
    } else {
        Some(filtered)
    };
    config::save_library(&library)
}

/// Deriva el path físico final a partir de la primera entrada enmascarada del registro.
#[tauri::command]
pub fn get_game_save_path(game_id: String) -> Result<String, String> {
    let library = config::load_library();
    let game = library
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        .ok_or_else(|| format!("Registro nulo: {}", game_id))?;
    let first = game.paths.first().ok_or("Entidad sin rutas vinculadas")?;

    expand_path(first.trim())
        .ok_or("Expansión topológica fallida".to_string())?
        .into_os_string()
        .into_string()
        .map_err(|_| "Formato codificado inválido".to_string())
}

/// Dispara el administrador de archivos predeterminado del sistema operativo hacia
/// la carpeta que contiene los datos del identificador.
#[tauri::command]
pub fn open_save_folder(game_id: String) -> Result<(), String> {
    let path = get_game_save_path(game_id)?;
    #[cfg(windows)]
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

const MAX_IMAGE_BYTES: u64 = 2 * 1024 * 1024;

/// Serializa el stream de bytes de un archivo de imagen estática local a un Data URI (Base64).
///
/// # Errors
///
/// Devuelve `Err` si el path no puede ser leído o excede el límite permisible
/// designado en memoria (2MB).
#[tauri::command]
pub fn read_image_as_data_url(path: String) -> Result<String, String> {
    let path = Path::new(path.trim());
    if !path.exists() {
        return Err("Recurso inaccesible o no existente".to_string());
    }

    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_IMAGE_BYTES {
        return Err("Asignación de buffer denegada por límite superado".to_string());
    }

    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => "image/jpeg",
    };

    Ok(format!(
        "data:{};base64,{}",
        mime,
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

/// Genera un dump local de la estructura monolítica hacia la ruta del argumento.
#[tauri::command]
pub fn export_config_to_file(path: String) -> Result<String, String> {
    let combined = config::get_combined_config();
    let json = serde_json::to_string_pretty(&combined).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Ingiere un blob JSON externo parseándolo sobre la topología de la aplicación.
///
/// # Arguments
///
/// * `path` - Ubicación de origen del archivo.
/// * `mode` - Instrucción de sobreescritura (`replace` para drop & insert, `merge` para upsert pacífico).
#[tauri::command]
pub fn import_config_from_file(path: String, mode: String) -> Result<(), String> {
    let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let imported: Config =
        serde_json::from_str(&contents).map_err(|e| format!("Estructura JSON corrupta: {}", e))?;

    if mode == "replace" {
        return config::apply_combined_config(&imported);
    }

    if mode == "merge" {
        let mut current = config::get_combined_config();

        for imp_game in imported.games {
            if let Some(existing) = current
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
                current.games.push(imp_game);
            }
        }
        for p in imported.custom_scan_paths {
            if !current.custom_scan_paths.contains(&p) {
                current.custom_scan_paths.push(p);
            }
        }
        current.gamification = crate::config::gamification::merge_gamification(
            &current.gamification,
            &imported.gamification,
        );
        if imported.profile_background.is_some() {
            current.profile_background = imported.profile_background.clone();
        }
        if imported.profile_avatar.is_some() {
            current.profile_avatar = imported.profile_avatar.clone();
        }
        if imported.profile_frame.is_some() {
            current.profile_frame = imported.profile_frame.clone();
        }
        current.share_visual_profile_with_hosts =
            current.share_visual_profile_with_hosts || imported.share_visual_profile_with_hosts;
        current.share_visual_profile_with_members =
            current.share_visual_profile_with_members || imported.share_visual_profile_with_members;
        return config::apply_combined_config(&current);
    }

    Err("Instrucción de modo de ingesta no reconocida".into())
}

/// Negocia transacciones HTTP hacia el Cloud Storage prescrito.
///
/// # Arguments
///
/// * `api_base` - Host URI.
/// * `user_id` - Clave partitiva de la instancia de nube.
/// * `api_key` - Token de autorización pre-empaquetado.
/// * `filename_or_key` - ID lógico o presignado del objeto remoto.
/// * `bytes` - Opcional. Blob de datos de subida (excluyente si `is_upload` es falso).
/// * `is_upload` - Determinador direccional de stream.
///
/// # Errors
///
/// Devuelve `Err` en colisiones HTTP u obstáculos I/O remotos.
async fn s3_transfer(
    api_base: &str,
    user_id: &str,
    api_key: &str,
    filename_or_key: &str,
    bytes: Option<Vec<u8>>,
    is_upload: bool,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("SaveCloud-desktop/1.0")
        .build()
        .unwrap();

    if is_upload {
        let body = serde_json::json!({ "gameId": "__config__", "filename": filename_or_key });
        let res = api_request(
            api_base,
            user_id,
            api_key,
            "POST",
            "/upload-url",
            Some(body.to_string().as_bytes()),
        )
        .await
        .map_err(|e| e.to_string())?;
        if !res.status().is_success() {
            let status = res.status();
            let detail = res.text().await.unwrap_or_default();
            return Err(format!("API POST /saves/upload-url: {} {}", status, detail));
        }
        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        let url = json
            .get("uploadUrl")
            .and_then(|v| v.as_str())
            .ok_or("Payload API sin puntero URL")?;
        let b = bytes.unwrap();
        let put_res = client
            .put(url)
            .body(b.clone())
            .header("Content-Type", "application/json")
            .header("Content-Length", b.len().to_string())
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !put_res.status().is_success() {
            return Err(format!(
                "Almacenamiento rechazó la subida (PUT): {}",
                put_res.status()
            ));
        }
        Ok(vec![])
    } else {
        // Usa download-urls (lote) en lugar de download-url: el caso de uso único valida
        // prefijo userId/gameId y falla para claves de miembros (host::member::...).
        let items = vec![("__config__".to_string(), filename_or_key.to_string())];
        let batch = get_download_urls(api_base, user_id, api_key, &items).await?;
        let url = batch
            .first()
            .map(|(u, _)| u.as_str())
            .ok_or("API no devolvió URL de descarga")?;
        client
            .get(url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| e.to_string())
    }
}

/// Extrae la imagen en memoria hacia un flujo que termina escrito en S3, simulando el nodo `__config__`.
#[tauri::command]
pub async fn backup_config_to_cloud() -> Result<(), String> {
    let ctx = resolve_api_context()?;
    let combined = config::get_combined_config();
    let bytes = serde_json::to_vec_pretty(&combined).unwrap();
    s3_transfer(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "config.json",
        Some(bytes),
        true,
    )
    .await
    .map(|_| ())
}

/// Extrae el archivo estático de S3 y lo reparte dinámicamente sobre la arquitectura de persistencia.
///
/// El flujo es el siguiente:
/// 1. Emite un volcado del último timestamp a disco por salvaguarda.
/// 2. Evalúa lista de objetos alojados, buscando el archivo JSON más reciente.
/// 3. Inicia stream remoto para consumirlo sobre una estructura monolítica pre-allocada.
/// 4. Distribuye la ingesta atómicamente por cada subsistema.
#[tauri::command]
pub async fn restore_config_from_cloud() -> Result<(), String> {
    let ctx = resolve_api_context()?;

    let saves =
        crate::commands::sync::api::sync_list_remote_saves_for_game("__config__".to_string())
            .await?;
    let mut config_saves: Vec<_> = saves
        .into_iter()
        .filter(|s| s.game_id == "__config__" && s.filename.ends_with("config.json"))
        .collect();
    if config_saves.is_empty() {
        return Err("Incapacidad de resolver nodo remoto de config".into());
    }
    config_saves.sort_by(|a, b| a.last_modified.cmp(&b.last_modified));
    let latest = config_saves
        .pop()
        .ok_or_else(|| "Incapacidad de resolver nodo remoto de config".to_string())?;

    let bytes = s3_transfer(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        &latest.key,
        None,
        false,
    )
    .await?;
    let imported: Config = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Incapacidad de mutar buffer: {}", e))?;

    if let Some(data_dir) = config::paths::data_dir() {
        if let Some(parent) = data_dir.parent() {
            let backup_dir = parent.join("config-backups");
            let _ = fs::create_dir_all(&backup_dir);
            let ts = Utc::now().format("%Y-%m-%d_%H-%M-%S");
            let backup_path = backup_dir.join(format!("config-{}.json", ts));
            let old_combined = config::get_combined_config();
            let _ = fs::write(
                &backup_path,
                serde_json::to_string_pretty(&old_combined).unwrap_or_default(),
            );
        }
    }

    config::apply_combined_config(&imported)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendProfileDto {
    pub user_id: String,
    pub total_playtime: u64,
    pub profile_background: Option<String>,
    pub profile_avatar: Option<String>,
    pub profile_frame: Option<String>,
    pub share_visual_profile_with_hosts: bool,
    pub share_visual_profile_with_members: bool,
    pub games: Vec<FriendGameDto>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendGameDto {
    pub id: String,
    pub steam_app_id: Option<String>,
    pub image_url: Option<String>,
    pub edition_label: Option<String>,
    pub playtime_seconds: u64,
    pub paths: Vec<String>,
    pub source_url: Option<String>,
}

/// Realiza una solicitud pasiva para parsear el bloque público alojado por otro usuario.
#[tauri::command]
pub async fn get_friend_config(friend_user_id: String) -> Result<FriendProfileDto, String> {
    let friend_id = friend_user_id.trim();
    if friend_id.is_empty() {
        return Err("Escribe el usuario del amigo.".into());
    }

    let ctx = resolve_api_context()?;

    let endpoint = format!(
        "{}/users/{}/profile",
        ctx.base_url.trim_end_matches('/'),
        friend_id
    );

    let response = crate::network::API_CLIENT
        .get(&endpoint)
        .header("x-api-key", ctx.api_key)
        .header("x-user-id", ctx.user_id)
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;

    if response.status().as_u16() == 404 {
        return Err("Ese usuario no tiene configuración respaldada en la nube.".into());
    }

    if !response.status().is_success() {
        return Err(format!(
            "Error del servidor ({}): {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    let profile = response
        .json::<FriendProfileDto>()
        .await
        .map_err(|e| format!("Error al procesar el perfil del amigo: {}", e))?;

    Ok(profile)
}

/// Anexa en bucle una matriz serializada enviada por la interfaz correspondiente al perfil amigo.
#[tauri::command]
pub fn add_games_from_friend(friend_games: Vec<GameDto>) -> Result<usize, String> {
    let mut library = config::load_library();
    let mut existing_ids: std::collections::HashSet<String> =
        library.games.iter().map(|g| g.id.to_lowercase()).collect();
    let mut added = 0usize;

    for g in friend_games {
        if g.id.trim().is_empty() || existing_ids.contains(&g.id.to_lowercase()) {
            continue;
        }
        library.games.push(ConfiguredGame {
            id: g.id.trim().to_string(),
            paths: if g.paths.is_empty() {
                vec!["(editar ruta en Configuración)".to_string()]
            } else {
                g.paths
            },
            steam_app_id: g.steam_app_id,
            image_url: g.image_url,
            executable_names: g.executable_names.clone(),
            edition_label: g.edition_label,
            source_url: g.source_url,
            magnet_link: None,
            launch_executable_path: g.launch_executable_path.clone(),
            playtime_seconds: 0,
        });
        existing_ids.insert(g.id.to_lowercase());
        added += 1;
    }

    if added > 0 {
        config::save_library(&library)?;
    }
    Ok(added)
}

/// Secuestra el snapshot en la nube adjunto a un Target ID y asume control lógico mutando el root ID local.
#[tauri::command]
pub async fn import_friend_config(friend_user_id: String) -> Result<(), String> {
    let friend_id = friend_user_id.trim();
    if friend_id.is_empty() {
        return Err("Escribe el usuario del amigo.".into());
    }

    let ctx = resolve_api_context()?;

    let saves = sync_list_remote_saves_for_user(friend_id.to_string()).await?;
    let mut config_saves: Vec<_> = saves
        .into_iter()
        .filter(|s| s.game_id == "__config__" && s.filename.ends_with("config.json"))
        .collect();
    if config_saves.is_empty() {
        return Err(
            "Ese usuario no tiene configuración respaldada en la nube (no se encontró config.json)."
                .into(),
        );
    }

    config_saves.sort_by(|a, b| a.last_modified.cmp(&b.last_modified));
    let latest = config_saves.pop().unwrap();

    let bytes = s3_transfer(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        &latest.key,
        None,
        false,
    )
    .await?;
    let mut imported: Config = serde_json::from_slice(&bytes)
        .map_err(|e| format!("El archivo de configuración descargado no es válido: {}", e))?;

    imported.user_id = Some(friend_id.to_string());

    config::apply_combined_config(&imported)
}

#[tauri::command]
pub fn get_gamification_state() -> GamificationStateDto {
    let g = config::load_gamification();
    let total = time::get_total_playtime();
    config::gamification::build_state_dto(&g, total)
}

#[tauri::command]
pub fn consume_achievement_toasts() -> Result<Vec<String>, String> {
    let mut g = config::load_gamification();
    let out = std::mem::take(&mut g.pending_achievement_toasts);
    config::save_gamification(&g)?;
    Ok(out)
}

#[tauri::command]
pub fn mark_shortcuts_hint_seen() -> Result<(), String> {
    let mut g = config::load_gamification();
    g.seen_shortcuts_hint = true;
    config::save_gamification(&g)
}

#[tauri::command]
pub fn mark_weekly_digest_notified(week_id: String) -> Result<(), String> {
    let mut g = config::load_gamification();
    g.last_weekly_digest_notification_week_id = week_id;
    config::save_gamification(&g)
}

#[tauri::command]
pub fn should_show_weekly_digest_notification(current_week_id: String) -> bool {
    let g = config::load_gamification();
    g.last_weekly_digest_notification_week_id != current_week_id && g.weekly_playtime_seconds >= 60
}
