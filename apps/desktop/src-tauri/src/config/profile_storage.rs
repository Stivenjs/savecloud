use super::io::{
    get_global_secure_api_key, get_global_secure_steam_web_api_key,
    set_global_secure_api_key, set_global_secure_steam_web_api_key,
};
use super::models::*;
use super::paths;
use super::profile_io;
use super::profiles::DEFAULT_PROFILE_ID;
use chrono::Utc;
use std::fs;
use std::path::PathBuf;

fn active_profile() -> Option<super::profiles::Profile> {
    let index = profile_io::load_profiles_index().ok()?;
    index.get_active_profile().cloned()
}

fn profile_file_path(profile_id: &str, file_name: &str) -> Option<PathBuf> {
    paths::data_dir().map(|dir| dir.join("profiles").join(profile_id.trim()).join(file_name))
}

fn is_default_profile_active() -> bool {
    active_profile()
        .as_ref()
        .is_some_and(|profile| profile.id == DEFAULT_PROFILE_ID)
}

fn scoped_data_path(file_name: &str) -> Option<PathBuf> {
    if let Some(profile) = active_profile() {
        return profile_file_path(&profile.id, file_name);
    }

    match file_name {
        paths::SETTINGS_FILE_NAME => paths::settings_path(),
        paths::LIBRARY_FILE_NAME => paths::library_path(),
        paths::HISTORY_FILE_NAME => paths::history_path(),
        paths::GAMIFICATION_FILE_NAME => paths::gamification_path(),
        _ => paths::data_dir().map(|dir| dir.join(file_name)),
    }
}

fn scoped_or_legacy_path(file_name: &str) -> Option<PathBuf> {
    if is_default_profile_active() {
        let scoped = scoped_data_path(file_name);
        if scoped.as_ref().is_some_and(|path| path.exists()) {
            return scoped;
        }

        return match file_name {
            paths::SETTINGS_FILE_NAME => paths::settings_path(),
            paths::LIBRARY_FILE_NAME => paths::library_path(),
            paths::HISTORY_FILE_NAME => paths::history_path(),
            paths::GAMIFICATION_FILE_NAME => paths::gamification_path(),
            _ => scoped,
        };
    }

    scoped_data_path(file_name)
}

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

fn save_json<T: serde::Serialize>(path: &std::path::Path, data: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn load_settings_raw() -> AppSettings {
    paths::settings_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str::<AppSettings>(&content).ok())
        .unwrap_or_default()
}

pub fn load_settings() -> AppSettings {
    let active_profile = active_profile();

    let mut settings = scoped_or_legacy_path(paths::SETTINGS_FILE_NAME)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str::<AppSettings>(&content).ok())
        .unwrap_or_default();

    if let Some(profile) = active_profile.as_ref() {
        settings.api_base_url = Some(profile.api_base_url.clone());
        settings.ws_base_url = Some(profile.ws_base_url.clone());
        settings.user_id = Some(profile.local_user_id.clone());
        settings.profile_avatar = profile.profile_avatar_url.clone();
        settings.profile_background = profile.profile_background.clone();
        settings.profile_frame = profile.profile_frame.clone();
        settings.custom_scan_paths = profile.custom_scan_paths.clone();
        settings.keep_backups_per_game = profile.keep_backups_per_game;
        settings.full_backup_streaming = profile.full_backup_streaming;
        settings.full_backup_streaming_dry_run = profile.full_backup_streaming_dry_run;
        settings.default_source_download_dir = profile.default_source_download_dir.clone();
        settings.share_visual_profile_with_hosts = profile.share_visual_profile_with_hosts;
        settings.share_visual_profile_with_members = profile.share_visual_profile_with_members;
    }

    let secure_key = active_profile
        .as_ref()
        .and_then(|profile| super::io::get_secure_api_key_for_profile(&profile.id))
        .or_else(get_global_secure_api_key);
    if secure_key.is_none() && settings.api_key.is_some() {
        if let Some(ref key) = settings.api_key {
            if let Some(profile) = active_profile.as_ref() {
                let _ = super::io::set_secure_api_key_for_profile(&profile.id, key);
            } else {
                let _ = set_global_secure_api_key(key);
            }
        }
    } else if let Some(key) = secure_key {
        settings.api_key = Some(key);
    }

    let secure_steam = get_global_secure_steam_web_api_key();
    if secure_steam.is_none()
        && settings
            .steam_web_api_key
            .as_ref()
            .map_or(false, |key| !key.trim().is_empty())
    {
        if let Some(ref key) = settings.steam_web_api_key {
            let _ = set_global_secure_steam_web_api_key(key);
        }
    } else if let Some(key) = secure_steam {
        settings.steam_web_api_key = Some(key);
    }

    if active_profile.is_none() {
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
    }
    apply_env_fallback(
        &mut settings.steam_web_api_key,
        option_env!("STEAM_WEB_API_KEY"),
        "STEAM_WEB_API_KEY",
    );

    settings
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let active_profile = active_profile();

    if let Some(ref key) = settings.api_key {
        if !key.trim().is_empty() {
            if let Some(profile) = active_profile.as_ref() {
                super::io::set_secure_api_key_for_profile(&profile.id, key)?;
            } else {
                set_global_secure_api_key(key)?;
            }
        }
    }

    if let Some(ref key) = settings.steam_web_api_key {
        if !key.trim().is_empty() {
            set_global_secure_steam_web_api_key(key)?;
        }
    }

    let path = scoped_data_path(paths::SETTINGS_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, settings)?;

    if is_default_profile_active() {
        if let Some(legacy_path) = paths::settings_path() {
            let _ = save_json(&legacy_path, settings);
        }
    }

    Ok(())
}

pub fn save_settings_for_profile(profile_id: &str, settings: &AppSettings) -> Result<(), String> {
    let path = profile_file_path(profile_id, paths::SETTINGS_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, settings)
}

pub fn save_library_for_profile(profile_id: &str, library: &GameLibrary) -> Result<(), String> {
    let path = profile_file_path(profile_id, paths::LIBRARY_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, library)
}

pub fn save_history_for_profile(profile_id: &str, history: &OperationHistory) -> Result<(), String> {
    let path = profile_file_path(profile_id, paths::HISTORY_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, history)
}

pub fn save_gamification_for_profile(
    profile_id: &str,
    gamification: &GamificationConfig,
) -> Result<(), String> {
    let path = profile_file_path(profile_id, paths::GAMIFICATION_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, gamification)
}

pub fn initialize_profile_storage(profile: &super::profiles::Profile) -> Result<(), String> {
    let settings = AppSettings {
        api_base_url: Some(profile.api_base_url.clone()),
        ws_base_url: Some(profile.ws_base_url.clone()),
        api_key: None,
        user_id: Some(profile.local_user_id.clone()),
        active_cloud_host_user_id: None,
        cloud_host_api_base_urls: Default::default(),
        cloud_host_ws_base_urls: Default::default(),
        custom_scan_paths: profile.custom_scan_paths.clone(),
        keep_backups_per_game: profile.keep_backups_per_game,
        full_backup_streaming: profile.full_backup_streaming,
        full_backup_streaming_dry_run: profile.full_backup_streaming_dry_run,
        default_source_download_dir: profile.default_source_download_dir.clone(),
        profile_background: profile.profile_background.clone(),
        profile_avatar: profile.profile_avatar_url.clone(),
        profile_frame: profile.profile_frame.clone(),
        share_visual_profile_with_hosts: profile.share_visual_profile_with_hosts,
        share_visual_profile_with_members: profile.share_visual_profile_with_members,
        steam_web_api_key: None,
    };

    save_settings_for_profile(&profile.id, &settings)?;
    save_library_for_profile(&profile.id, &GameLibrary::default())?;
    save_history_for_profile(&profile.id, &OperationHistory::default())?;
    save_gamification_for_profile(&profile.id, &GamificationConfig::default())?;

    Ok(())
}

pub fn load_library() -> GameLibrary {
    scoped_or_legacy_path(paths::LIBRARY_FILE_NAME)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_library(library: &GameLibrary) -> Result<(), String> {
    let path = scoped_data_path(paths::LIBRARY_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, library)?;

    if is_default_profile_active() {
        if let Some(legacy_path) = paths::library_path() {
            let _ = save_json(&legacy_path, library);
        }
    }

    Ok(())
}

pub fn load_history() -> OperationHistory {
    scoped_or_legacy_path(paths::HISTORY_FILE_NAME)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str(&content).ok())
        .unwrap_or_default()
}

pub fn save_history(history: &OperationHistory) -> Result<(), String> {
    let path = scoped_data_path(paths::HISTORY_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, history)?;

    if is_default_profile_active() {
        if let Some(legacy_path) = paths::history_path() {
            let _ = save_json(&legacy_path, history);
        }
    }

    Ok(())
}

pub fn load_gamification() -> GamificationConfig {
    let Some(path) = scoped_or_legacy_path(paths::GAMIFICATION_FILE_NAME) else {
        return GamificationConfig::default();
    };
    fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<GamificationConfig>(&content).ok())
        .unwrap_or_default()
}

pub fn save_gamification(gamification: &GamificationConfig) -> Result<(), String> {
    let Some(path) = scoped_data_path(paths::GAMIFICATION_FILE_NAME) else {
        return Err("Ruta de datos no disponible".to_string());
    };
    save_json(&path, gamification)?;

    if is_default_profile_active() {
        if let Some(legacy_path) = paths::gamification_path() {
            let _ = save_json(&legacy_path, gamification);
        }
    }

    Ok(())
}

pub fn append_operation_log(
    kind: &str,
    game_id: &str,
    file_count: u32,
    err_count: u32,
) -> Result<(), String> {
    let mut history = load_history();
    let mut gamification = load_gamification();

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

    super::gamification::on_operation_logged_inner(&mut gamification, kind, file_count, err_count);

    save_history(&history)?;
    save_gamification(&gamification)?;
    Ok(())
}