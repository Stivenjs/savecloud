//! Operaciones de entrada y salida para la persistencia del estado.
//!
//! Mantiene el manejo de secretos del sistema operativo y expone una fachada
//! delgada hacia la persistencia por perfil y la configuración combinada.

use super::models::*;
use super::profile_storage;
use keyring::Entry;

pub const KEYRING_SERVICE: &str = "savecloud_api";
pub const KEYRING_ACCOUNT: &str = "default_user";
const KEYRING_ACCOUNT_CLOUD_HOST_PREFIX: &str = "cloud_host_";
const KEYRING_ACCOUNT_STEAM_WEB_API: &str = "steam_web_api";

fn get_secure_api_key() -> Option<String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|key| key != MASKED_API_KEY)
}

pub fn get_global_secure_api_key() -> Option<String> {
    get_secure_api_key()
}

fn set_secure_api_key(key: &str) -> Result<(), String> {
    if key == MASKED_API_KEY {
        return Ok(());
    }

    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())?;
    entry.set_password(key).map_err(|error| error.to_string())
}

pub fn set_global_secure_api_key(key: &str) -> Result<(), String> {
    set_secure_api_key(key)
}

fn cloud_host_keyring_account(host_user_id: &str) -> String {
    format!(
        "{}{}",
        KEYRING_ACCOUNT_CLOUD_HOST_PREFIX,
        host_user_id.trim()
    )
}

pub fn get_secure_api_key_for_cloud_host(host_user_id: &str) -> Option<String> {
    let account = cloud_host_keyring_account(host_user_id);
    Entry::new(KEYRING_SERVICE, &account)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|key| key != MASKED_API_KEY)
}

pub fn set_secure_api_key_for_cloud_host(host_user_id: &str, key: &str) -> Result<(), String> {
    if key == MASKED_API_KEY {
        return Ok(());
    }

    let account = cloud_host_keyring_account(host_user_id);
    let entry = Entry::new(KEYRING_SERVICE, &account).map_err(|error| error.to_string())?;
    entry.set_password(key).map_err(|error| error.to_string())
}

fn get_secure_steam_web_api_key() -> Option<String> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT_STEAM_WEB_API)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|key| key != MASKED_STEAM_WEB_API_KEY)
}

pub fn get_global_secure_steam_web_api_key() -> Option<String> {
    get_secure_steam_web_api_key()
}

fn set_secure_steam_web_api_key(key: &str) -> Result<(), String> {
    if key == MASKED_STEAM_WEB_API_KEY {
        return Ok(());
    }

    let entry = Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT_STEAM_WEB_API)
        .map_err(|error| error.to_string())?;
    entry.set_password(key).map_err(|error| error.to_string())
}

pub fn set_global_secure_steam_web_api_key(key: &str) -> Result<(), String> {
    set_secure_steam_web_api_key(key)
}

fn profile_keyring_account(profile_id: &str) -> String {
    format!("savecloud_profile_{}", profile_id.trim())
}

pub fn get_secure_api_key_for_profile(profile_id: &str) -> Option<String> {
    let account = profile_keyring_account(profile_id);
    Entry::new(KEYRING_SERVICE, &account)
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .filter(|key| key != MASKED_API_KEY)
}

pub fn set_secure_api_key_for_profile(profile_id: &str, key: &str) -> Result<(), String> {
    if key == MASKED_API_KEY {
        return Ok(());
    }

    let account = profile_keyring_account(profile_id);
    let entry = Entry::new(KEYRING_SERVICE, &account).map_err(|error| error.to_string())?;
    entry.set_password(key).map_err(|error| error.to_string())
}

pub fn delete_secure_api_key_for_profile(profile_id: &str) -> Result<(), String> {
    let account = profile_keyring_account(profile_id);
    let entry = Entry::new(KEYRING_SERVICE, &account).map_err(|error| error.to_string())?;
    entry.delete_password().map_err(|error| error.to_string())
}

pub fn load_settings() -> AppSettings {
    profile_storage::load_settings()
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    profile_storage::save_settings(settings)
}

pub fn load_library() -> GameLibrary {
    profile_storage::load_library()
}

pub fn save_library(library: &GameLibrary) -> Result<(), String> {
    profile_storage::save_library(library)
}

pub fn load_history() -> OperationHistory {
    profile_storage::load_history()
}

pub fn save_history(history: &OperationHistory) -> Result<(), String> {
    profile_storage::save_history(history)
}

pub fn load_gamification() -> GamificationConfig {
    profile_storage::load_gamification()
}

pub fn save_gamification(gamification: &GamificationConfig) -> Result<(), String> {
    profile_storage::save_gamification(gamification)
}

pub fn append_operation_log(
    kind: &str,
    game_id: &str,
    file_count: u32,
    err_count: u32,
) -> Result<(), String> {
    profile_storage::append_operation_log(kind, game_id, file_count, err_count)
}

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
        cloud_host_ws_base_urls: settings.cloud_host_ws_base_urls,
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

pub fn apply_combined_config(cfg: &Config) -> Result<(), String> {
    let mut current_settings = load_settings();

    current_settings.api_base_url = cfg.api_base_url.clone().or(current_settings.api_base_url);
    current_settings.api_key = cfg
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|key| *key != crate::config::MASKED_API_KEY && !key.is_empty())
        .map(String::from)
        .or(current_settings.api_key);

    current_settings.user_id = cfg.user_id.clone().or(current_settings.user_id);
    current_settings.active_cloud_host_user_id = cfg
        .active_cloud_host_user_id
        .clone()
        .or(current_settings.active_cloud_host_user_id);
    current_settings.cloud_host_ws_base_urls = cfg.cloud_host_ws_base_urls.clone();
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

pub fn load_config() -> Config {
    get_combined_config()
}
