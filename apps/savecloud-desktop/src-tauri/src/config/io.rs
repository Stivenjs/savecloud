//! Operaciones de entrada y salida para la persistencia del estado.
//!
//! Garantiza escrituras atómicas localizadas, gestiona la inyección de
//! dependencias desde el entorno, y asegura las credenciales vía Keyring.

use super::{models::*, paths};
use chrono::Utc;
use keyring::Entry;
use std::fs;

pub const KEYRING_SERVICE: &str = "savecloud_api";
pub const KEYRING_ACCOUNT: &str = "default_user";
const KEYRING_ACCOUNT_CLOUD_HOST_PREFIX: &str = "cloud_host_";
const KEYRING_ACCOUNT_STEAM_WEB_API: &str = "steam_web_api";

/// Recupera la clave de la API desde el almacenamiento seguro del sistema operativo.
fn get_secure_api_key() -> Option<String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|k| k != MASKED_API_KEY)
}

/// Registra o actualiza la clave de la API en el almacenamiento seguro del SO.
///
/// # Arguments
///
/// * `key` - Cadena de texto que contiene el secreto a proteger.
///
/// # Errors
///
/// Devuelve `Err` si el backend criptográfico del sistema operativo rechaza
/// la operación o si el servicio de Keyring no está disponible.
fn set_secure_api_key(key: &str) -> Result<(), String> {
    if key == MASKED_API_KEY {
        return Ok(());
    }

    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

fn cloud_host_keyring_account(host_user_id: &str) -> String {
    // Evita colisiones simples y mantiene independencia por host invitador.
    format!(
        "{}{}",
        KEYRING_ACCOUNT_CLOUD_HOST_PREFIX,
        host_user_id.trim()
    )
}

/// Recupera el accessToken guardado en el Keyring para una nube de un host concreto.
pub fn get_secure_api_key_for_cloud_host(host_user_id: &str) -> Option<String> {
    let account = cloud_host_keyring_account(host_user_id);
    Entry::new(KEYRING_SERVICE, &account)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|k| k != MASKED_API_KEY)
}

/// Guarda el accessToken en el Keyring para una nube de un host concreto.
pub fn set_secure_api_key_for_cloud_host(host_user_id: &str, key: &str) -> Result<(), String> {
    if key == MASKED_API_KEY {
        return Ok(());
    }
    let account = cloud_host_keyring_account(host_user_id);
    let entry = Entry::new(KEYRING_SERVICE, &account).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

fn get_secure_steam_web_api_key() -> Option<String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT_STEAM_WEB_API)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|k| k != MASKED_STEAM_WEB_API_KEY)
}

fn set_secure_steam_web_api_key(key: &str) -> Result<(), String> {
    if key == MASKED_STEAM_WEB_API_KEY {
        return Ok(());
    }

    let entry =
        Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT_STEAM_WEB_API).map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())
}

/// Inyecta el valor de una variable de entorno en un campo opcional,
/// priorizando el valor en tiempo de compilación sobre el valor en tiempo de ejecución.
fn apply_env_fallback(
    field: &mut Option<String>,
    compile_env: Option<&'static str>,
    runtime_env: &str,
) {
    if field.as_deref().map_or(true, str::is_empty) {
        let env_val = compile_env
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
            .or_else(|| {
                std::env::var(runtime_env)
                    .ok()
                    .filter(|s| !s.trim().is_empty())
            });

        if let Some(v) = env_val {
            *field = Some(v);
        }
    }
}

/// Escribe una estructura serializable a disco garantizando la creación del directorio padre.
///
/// # Errors
///
/// Devuelve `Err` si el sistema de archivos deniega la creación de la ruta
/// o si ocurre un error de I/O durante la escritura.
fn save_json<T: serde::Serialize>(path: &std::path::Path, data: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

/// Carga las configuraciones generales del usuario.
///
/// El flujo es el siguiente:
/// 1. Intenta deserializar `settings.json`. En caso de fallo, instancia valores por defecto.
/// 2. Consulta el Keyring del SO en busca de la clave API.
/// 3. Si la clave reside en el JSON cargado pero no en el Keyring, realiza la migración
///    de forma transparente, asegurando el secreto.
/// 4. Resuelve valores faltantes utilizando variables de entorno de respaldo.
pub fn load_settings() -> AppSettings {
    let mut settings = paths::settings_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str::<AppSettings>(&c).ok())
        .unwrap_or_default();

    let secure_key = get_secure_api_key();
    if secure_key.is_none() && settings.api_key.is_some() {
        if let Some(ref k) = settings.api_key {
            let _ = set_secure_api_key(k);
        }
    } else if let Some(sk) = secure_key {
        settings.api_key = Some(sk);
    }

    let secure_steam = get_secure_steam_web_api_key();
    if secure_steam.is_none()
        && settings
            .steam_web_api_key
            .as_ref()
            .map_or(false, |k| !k.trim().is_empty())
    {
        if let Some(ref k) = settings.steam_web_api_key {
            let _ = set_secure_steam_web_api_key(k);
        }
    } else if let Some(sk) = secure_steam {
        settings.steam_web_api_key = Some(sk);
    }

    apply_env_fallback(
        &mut settings.api_base_url,
        option_env!("SYNC_GAMES_API_URL"),
        "SYNC_GAMES_API_URL",
    );
    apply_env_fallback(
        &mut settings.api_key,
        option_env!("SYNC_GAMES_API_KEY"),
        "SYNC_GAMES_API_KEY",
    );
    apply_env_fallback(
        &mut settings.user_id,
        option_env!("SYNC_GAMES_USER_ID"),
        "SYNC_GAMES_USER_ID",
    );
    apply_env_fallback(
        &mut settings.steam_web_api_key,
        option_env!("STEAM_WEB_API_KEY"),
        "STEAM_WEB_API_KEY",
    );

    settings
}

/// Persiste las configuraciones de la aplicación en disco.
///
/// Extrae automáticamente la clave API y la clave Steam Web API de la estructura
/// en memoria e intenta guardarlas en el backend criptográfico antes de escribir el JSON.
///
/// # Errors
///
/// Devuelve `Err` en caso de fallos de I/O o si el gestor de credenciales falla.
pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    if let Some(ref key) = settings.api_key {
        if !key.trim().is_empty() {
            set_secure_api_key(key)?;
        }
    }
    if let Some(ref key) = settings.steam_web_api_key {
        if !key.trim().is_empty() {
            set_secure_steam_web_api_key(key)?;
        }
    }
    let path = paths::settings_path().ok_or("Ruta no disponible")?;
    save_json(&path, settings)
}

/// Carga la biblioteca de juegos configurada por el usuario.
pub fn load_library() -> GameLibrary {
    paths::library_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Sobrescribe la biblioteca de juegos en el sistema de archivos.
pub fn save_library(library: &GameLibrary) -> Result<(), String> {
    let path = paths::library_path().ok_or("Ruta no disponible")?;
    save_json(&path, library)
}

/// Carga el historial de operaciones localizadas.
pub fn load_history() -> OperationHistory {
    paths::history_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

/// Persiste el registro histórico de operaciones en el sistema de archivos.
///
/// Delega la serialización y escritura a disco a la función genérica interna,
/// asegurando la creación de directorios si estos no existen.
///
/// # Arguments
///
/// * `history` - Referencia a la estructura que contiene el listado completo de operaciones.
///
/// # Errors
///
/// Devuelve `Err` si la ruta de destino no puede resolverse o si el sistema
/// de archivos deniega la escritura.
pub fn save_history(history: &OperationHistory) -> Result<(), String> {
    let path = paths::history_path().ok_or("Ruta no disponible")?;
    save_json(&path, history)
}

/// Agrega un evento al registro histórico limitando el tamaño del archivo.
///
/// El flujo es el siguiente:
/// 1. Carga el historial existente en memoria.
/// 2. Adjunta el nuevo evento serializado con un timestamp UTC.
/// 3. Si el vector resultante supera los 200 elementos, purga los más antiguos.
/// 4. Escribe la estructura mutada de regreso a disco.
///
/// # Arguments
///
/// * `kind` - Clasificación de la operación (ej. "upload", "download").
/// * `game_id` - Identificador unívoco del juego involucrado.
/// * `file_count` - Cantidad de archivos procesados exitosamente.
/// * `err_count` - Cantidad de errores emitidos durante el ciclo.
///
/// # Errors
///
/// Devuelve `Err` si la ruta de persistencia no es resoluble o falla la escritura.
pub fn append_operation_log(
    kind: &str,
    game_id: &str,
    file_count: u32,
    err_count: u32,
) -> Result<(), String> {
    let mut history = load_history();
    history.entries.push(OperationLogEntry {
        timestamp: Utc::now().to_rfc3339(),
        kind: kind.to_string(),
        game_id: game_id.to_string(),
        file_count,
        err_count,
    });

    const MAX_ENTRIES: usize = 200;
    if history.entries.len() > MAX_ENTRIES {
        let drop = history.entries.len() - MAX_ENTRIES;
        history.entries.drain(0..drop);
    }

    let path = paths::history_path().ok_or("Ruta no disponible")?;
    save_json(&path, &history)?;

    let mut g = load_gamification();
    super::gamification::on_operation_logged_inner(&mut g, kind, file_count, err_count);
    save_gamification(&g)?;

    Ok(())
}

/// Genera una instancia monolítica combinando todos los estados persistidos.
///
/// Reúne en memoria el contenido de `settings.json`, `library.json` e `history.json`
/// para construir un objeto `Config` integral, necesario para exportaciones S3.
pub fn get_combined_config() -> Config {
    let settings = load_settings();
    let library = load_library();
    let history = load_history();

    Config {
        api_base_url: settings.api_base_url,
        ws_base_url: settings.ws_base_url,
        api_key: settings.api_key,
        user_id: settings.user_id,
        active_cloud_host_user_id: settings.active_cloud_host_user_id,
        custom_scan_paths: settings.custom_scan_paths,
        keep_backups_per_game: settings.keep_backups_per_game,
        full_backup_streaming: settings.full_backup_streaming,
        full_backup_streaming_dry_run: settings.full_backup_streaming_dry_run,
        default_source_download_dir: settings.default_source_download_dir,
        profile_background: settings.profile_background.clone(),
        profile_avatar: settings.profile_avatar.clone(),
        profile_frame: settings.profile_frame.clone(),
        share_visual_profile_with_hosts: settings.share_visual_profile_with_hosts,
        share_visual_profile_with_members: settings.share_visual_profile_with_members,
        games: library.games,
        operation_history: history.entries,
        gamification: load_gamification(),
    }
}

/// Carga el bloque de gamificación desde disco (o valores por defecto).
pub fn load_gamification() -> GamificationConfig {
    let Some(path) = paths::gamification_path() else {
        return GamificationConfig::default();
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|c| serde_json::from_str::<GamificationConfig>(&c).ok())
        .unwrap_or_default()
}

pub fn save_gamification(g: &GamificationConfig) -> Result<(), String> {
    let Some(path) = paths::gamification_path() else {
        return Err("Ruta de datos no disponible".to_string());
    };
    save_json(&path, g)
}

/// Descompone una instancia monolítica y distribuye sus componentes a disco.
///
/// # Arguments
///
/// * `cfg` - Referencia a la configuración integral que será segmentada.
///
/// # Errors
///
/// Devuelve `Err` si alguna de las escrituras atómicas hacia los subsistemas falla.
pub fn apply_combined_config(cfg: &Config) -> Result<(), String> {
    let mut current_settings = load_settings();

    current_settings.api_base_url = cfg.api_base_url.clone().or(current_settings.api_base_url);

    current_settings.api_key = cfg
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|k| *k != crate::config::MASKED_API_KEY && !k.is_empty())
        .map(String::from)
        .or(current_settings.api_key);

    current_settings.user_id = cfg.user_id.clone().or(current_settings.user_id);
    current_settings.active_cloud_host_user_id = cfg
        .active_cloud_host_user_id
        .clone()
        .or(current_settings.active_cloud_host_user_id);
    current_settings.custom_scan_paths = cfg.custom_scan_paths.clone();
    current_settings.keep_backups_per_game = cfg.keep_backups_per_game;
    current_settings.full_backup_streaming = cfg.full_backup_streaming;
    current_settings.full_backup_streaming_dry_run = cfg.full_backup_streaming_dry_run;
    current_settings.default_source_download_dir = cfg
        .default_source_download_dir
        .clone()
        .or(current_settings.default_source_download_dir);

    current_settings.profile_background = cfg
        .profile_background
        .clone()
        .or(current_settings.profile_background);
    current_settings.profile_avatar = cfg
        .profile_avatar
        .clone()
        .or(current_settings.profile_avatar);
    current_settings.profile_frame = cfg.profile_frame.clone().or(current_settings.profile_frame);
    current_settings.share_visual_profile_with_hosts = cfg.share_visual_profile_with_hosts;
    current_settings.share_visual_profile_with_members = cfg.share_visual_profile_with_members;

    save_settings(&current_settings)?;
    save_library(&GameLibrary {
        games: cfg.games.clone(),
    })?;
    save_history(&OperationHistory {
        entries: cfg.operation_history.clone(),
    })?;
    save_gamification(&cfg.gamification)?;

    Ok(())
}

/// Carga la configuración combinada. Útil para mantener la compatibilidad con código legacy.
pub fn load_config() -> Config {
    get_combined_config()
}
