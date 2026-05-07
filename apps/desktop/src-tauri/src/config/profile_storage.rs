use super::io::{
    get_global_secure_api_key, get_global_secure_steam_web_api_key, get_secure_api_key_for_profile,
    get_secure_steam_web_api_key_for_profile, set_global_secure_api_key,
    set_global_secure_steam_web_api_key, set_secure_api_key_for_profile,
    set_secure_steam_web_api_key_for_profile,
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

fn profile_directory_path(profile_id: &str) -> Option<PathBuf> {
    paths::data_dir().map(|dir| dir.join("profiles").join(profile_id.trim()))
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

fn legacy_root_path(file_name: &str) -> Option<PathBuf> {
    match file_name {
        paths::SETTINGS_FILE_NAME => paths::settings_path(),
        paths::LIBRARY_FILE_NAME => paths::library_path(),
        paths::HISTORY_FILE_NAME => paths::history_path(),
        paths::GAMIFICATION_FILE_NAME => paths::gamification_path(),
        _ => paths::data_dir().map(|dir| dir.join(file_name)),
    }
}

fn scoped_or_legacy_path(file_name: &str) -> Option<PathBuf> {
    let scoped = scoped_data_path(file_name);
    if scoped.as_ref().is_some_and(|path| path.exists()) {
        return scoped;
    }

    if is_default_profile_active() {
        let legacy = legacy_root_path(file_name);
        if legacy.as_ref().is_some_and(|path| path.exists()) {
            return legacy;
        }
        return scoped.or(legacy);
    }

    scoped
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
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
    if let Ok(existing) = fs::read_to_string(path) {
        if existing == content {
            return Ok(());
        }
    }

    let temp_path = path.with_extension("json.tmp");
    fs::write(&temp_path, content).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    fs::rename(&temp_path, path).map_err(|e| e.to_string())
}

type GetProfileSecretFn = fn(&str) -> Option<String>;
type GetGlobalSecretFn = fn() -> Option<String>;
type SetProfileSecretFn = fn(&str, &str) -> Result<(), String>;
type SetGlobalSecretFn = fn(&str) -> Result<(), String>;

fn resolve_secret_for_active_profile(
    active_profile: Option<&super::profiles::Profile>,
    get_profile_secret: GetProfileSecretFn,
    get_global_secret: GetGlobalSecretFn,
) -> Option<String> {
    match active_profile {
        Some(profile) if profile.id == DEFAULT_PROFILE_ID => {
            get_profile_secret(&profile.id).or_else(get_global_secret)
        }
        Some(profile) => get_profile_secret(&profile.id),
        None => get_global_secret(),
    }
}

fn migrate_secret_to_secure_store(
    active_profile: Option<&super::profiles::Profile>,
    secret: &str,
    set_profile_secret: SetProfileSecretFn,
    set_global_secret: SetGlobalSecretFn,
) {
    if let Some(profile) = active_profile {
        let _ = set_profile_secret(&profile.id, secret);
        if profile.id == DEFAULT_PROFILE_ID {
            let _ = set_global_secret(secret);
        }
    } else {
        let _ = set_global_secret(secret);
    }
}

fn hydrate_secret_field(
    field: &mut Option<String>,
    active_profile: Option<&super::profiles::Profile>,
    get_profile_secret: GetProfileSecretFn,
    get_global_secret: GetGlobalSecretFn,
    set_profile_secret: SetProfileSecretFn,
    set_global_secret: SetGlobalSecretFn,
) {
    let secure_secret =
        resolve_secret_for_active_profile(active_profile, get_profile_secret, get_global_secret);

    if let Some(secret) = secure_secret {
        *field = Some(secret);
        return;
    }

    if let Some(legacy_secret) = field
        .as_deref()
        .map(str::trim)
        .filter(|key| !key.is_empty())
    {
        migrate_secret_to_secure_store(
            active_profile,
            legacy_secret,
            set_profile_secret,
            set_global_secret,
        );
    }
}

fn persist_secret_for_active_profile(
    field: Option<&str>,
    active_profile: Option<&super::profiles::Profile>,
    set_profile_secret: SetProfileSecretFn,
    set_global_secret: SetGlobalSecretFn,
) -> Result<(), String> {
    let Some(secret) = field.map(str::trim).filter(|key| !key.is_empty()) else {
        return Ok(());
    };

    if let Some(profile) = active_profile {
        return set_profile_secret(&profile.id, secret);
    }

    set_global_secret(secret)
}

pub fn load_settings_raw() -> AppSettings {
    paths::settings_path()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str::<AppSettings>(&content).ok())
        .unwrap_or_default()
}

pub fn load_settings() -> AppSettings {
    let active_profile = active_profile();
    let active_profile_ref = active_profile.as_ref();

    let mut settings = scoped_or_legacy_path(paths::SETTINGS_FILE_NAME)
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|content| serde_json::from_str::<AppSettings>(&content).ok())
        .unwrap_or_default();

    hydrate_secret_field(
        &mut settings.api_key,
        active_profile_ref,
        get_secure_api_key_for_profile,
        get_global_secure_api_key,
        set_secure_api_key_for_profile,
        set_global_secure_api_key,
    );

    hydrate_secret_field(
        &mut settings.steam_web_api_key,
        active_profile_ref,
        get_secure_steam_web_api_key_for_profile,
        get_global_secure_steam_web_api_key,
        set_secure_steam_web_api_key_for_profile,
        set_global_secure_steam_web_api_key,
    );

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
    if active_profile.is_none() {
        apply_env_fallback(
            &mut settings.steam_web_api_key,
            option_env!("STEAM_WEB_API_KEY"),
            "STEAM_WEB_API_KEY",
        );
    }

    settings
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let active_profile = active_profile();

    persist_secret_for_active_profile(
        settings.api_key.as_deref(),
        active_profile.as_ref(),
        set_secure_api_key_for_profile,
        set_global_secure_api_key,
    )?;

    persist_secret_for_active_profile(
        settings.steam_web_api_key.as_deref(),
        active_profile.as_ref(),
        set_secure_steam_web_api_key_for_profile,
        set_global_secure_steam_web_api_key,
    )?;

    let path = scoped_data_path(paths::SETTINGS_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, settings)?;

    // Mantiene sincronizado el perfil activo para evitar que load_settings()
    // vuelva a inyectar valores antiguos desde profiles.json.
    if let Some(active) = active_profile.as_ref() {
        let mut index = profile_io::load_profiles_index()?;
        if let Some(profile) = index.get_profile_mut(&active.id) {
            if let Some(api_base_url) = settings
                .api_base_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                profile.api_base_url = api_base_url.to_string();
            }

            if let Some(ws_base_url) = settings
                .ws_base_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                profile.ws_base_url = ws_base_url.to_string();
            }

            if let Some(user_id) = settings
                .user_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                profile.local_user_id = user_id.to_string();
            }

            profile.profile_avatar_url = settings.profile_avatar.clone();
            profile.profile_background = settings.profile_background.clone();
            profile.profile_frame = settings.profile_frame.clone();
            profile.cloud_host_api_base_urls = settings.cloud_host_api_base_urls.clone();
            profile.cloud_host_ws_base_urls = settings.cloud_host_ws_base_urls.clone();
            profile.custom_scan_paths = settings.custom_scan_paths.clone();
            profile.keep_backups_per_game = settings.keep_backups_per_game;
            profile.full_backup_streaming = settings.full_backup_streaming;
            profile.full_backup_streaming_dry_run = settings.full_backup_streaming_dry_run;
            profile.full_backup_packaged_compression_level =
                settings.full_backup_packaged_compression_level;
            profile.default_source_download_dir = settings.default_source_download_dir.clone();
            profile.share_visual_profile_with_hosts = settings.share_visual_profile_with_hosts;
            profile.share_visual_profile_with_members = settings.share_visual_profile_with_members;

            profile_io::save_profiles_index(&index)?;
        }
    }

    Ok(())
}

pub fn save_settings_for_profile(profile_id: &str, settings: &AppSettings) -> Result<(), String> {
    let path =
        profile_file_path(profile_id, paths::SETTINGS_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, settings)
}

pub fn save_library_for_profile(profile_id: &str, library: &GameLibrary) -> Result<(), String> {
    let path =
        profile_file_path(profile_id, paths::LIBRARY_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, library)
}

pub fn save_history_for_profile(
    profile_id: &str,
    history: &OperationHistory,
) -> Result<(), String> {
    let path =
        profile_file_path(profile_id, paths::HISTORY_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, history)
}

pub fn save_gamification_for_profile(
    profile_id: &str,
    gamification: &GamificationConfig,
) -> Result<(), String> {
    let path =
        profile_file_path(profile_id, paths::GAMIFICATION_FILE_NAME).ok_or("Ruta no disponible")?;
    save_json(&path, gamification)
}

pub fn initialize_profile_storage(profile: &super::profiles::Profile) -> Result<(), String> {
    let settings = AppSettings {
        api_base_url: Some(profile.api_base_url.clone()),
        ws_base_url: Some(profile.ws_base_url.clone()),
        api_key: None,
        user_id: Some(profile.local_user_id.clone()),
        active_cloud_host_user_id: None,
        preferred_gamepad_layout: None,
        startup_window_mode: None,
        cloud_host_api_base_urls: Default::default(),
        cloud_host_ws_base_urls: Default::default(),
        custom_scan_paths: profile.custom_scan_paths.clone(),
        keep_backups_per_game: profile.keep_backups_per_game,
        full_backup_streaming: profile.full_backup_streaming,
        full_backup_streaming_dry_run: profile.full_backup_streaming_dry_run,
        full_backup_packaged_compression_level: profile.full_backup_packaged_compression_level,
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

pub fn delete_profile_storage(profile_id: &str) -> Result<(), String> {
    let Some(profile_dir) = profile_directory_path(profile_id) else {
        return Ok(());
    };

    if profile_dir.exists() {
        fs::remove_dir_all(&profile_dir).map_err(|e| e.to_string())?;
    }

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
