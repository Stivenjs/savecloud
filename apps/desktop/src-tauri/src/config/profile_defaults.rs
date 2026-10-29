use super::profile_storage::load_settings_for_profile;
use super::profiles::{Profile, ProfilesIndex, DEFAULT_PROFILE_ID};
use chrono::Utc;

pub fn build_default_profile() -> Profile {
    let settings = load_settings_for_profile(DEFAULT_PROFILE_ID);
    let now = Utc::now().timestamp();

    Profile {
        id: DEFAULT_PROFILE_ID.to_string(),
        name: "Principal".to_string(),
        local_user_id: settings.user_id.unwrap_or_default(),
        api_base_url: settings.api_base_url.unwrap_or_default(),
        ws_base_url: settings.ws_base_url.unwrap_or_default(),
        profile_avatar_url: settings.profile_avatar,
        created_at: now,
        last_used: now,
        cloud_host_api_base_urls: settings.cloud_host_api_base_urls,
        cloud_host_ws_base_urls: settings.cloud_host_ws_base_urls,
        custom_scan_paths: settings.custom_scan_paths,
        keep_backups_per_game: settings.keep_backups_per_game,
        full_backup_streaming: settings.full_backup_streaming,
        full_backup_streaming_dry_run: settings.full_backup_streaming_dry_run,
        full_backup_packaged_compression_level: settings.full_backup_packaged_compression_level,
        default_source_download_dir: settings.default_source_download_dir,
        profile_background: settings.profile_background,
        profile_frame: settings.profile_frame,
        share_visual_profile_with_hosts: settings.share_visual_profile_with_hosts,
        share_visual_profile_with_members: settings.share_visual_profile_with_members,
        auto_extract_downloads: settings.auto_extract_downloads,
    }
}

pub fn ensure_default_profile(index: &mut ProfilesIndex) -> bool {
    if let Some(profile) = index.get_profile_mut(DEFAULT_PROFILE_ID) {
        let settings = load_settings_for_profile(DEFAULT_PROFILE_ID);
        profile.local_user_id = settings.user_id.unwrap_or_default();
        profile.api_base_url = settings.api_base_url.unwrap_or_default();
        profile.ws_base_url = settings.ws_base_url.unwrap_or_default();
        profile.profile_avatar_url = settings.profile_avatar;
        profile.profile_background = settings.profile_background;
        profile.profile_frame = settings.profile_frame;
        profile.cloud_host_api_base_urls = settings.cloud_host_api_base_urls;
        profile.cloud_host_ws_base_urls = settings.cloud_host_ws_base_urls;
        profile.custom_scan_paths = settings.custom_scan_paths;
        profile.keep_backups_per_game = settings.keep_backups_per_game;
        profile.full_backup_streaming = settings.full_backup_streaming;
        profile.full_backup_streaming_dry_run = settings.full_backup_streaming_dry_run;
        profile.full_backup_packaged_compression_level = settings.full_backup_packaged_compression_level;
        profile.default_source_download_dir = settings.default_source_download_dir;
        profile.share_visual_profile_with_hosts = settings.share_visual_profile_with_hosts;
        profile.share_visual_profile_with_members = settings.share_visual_profile_with_members;
        profile.auto_extract_downloads = settings.auto_extract_downloads;

        if index.active_profile_id.trim().is_empty() {
            index.active_profile_id = DEFAULT_PROFILE_ID.to_string();
        }
        return true;
    }

    index.profiles.insert(0, build_default_profile());
    if index.active_profile_id.trim().is_empty() {
        index.active_profile_id = DEFAULT_PROFILE_ID.to_string();
    }
    true
}

/// Descubre y recupera automáticamente perfiles existentes en disco (`data/profiles/*`)
/// que no se encuentren registrados en el índice en memoria.
pub fn auto_discover_profiles_from_disk(index: &mut ProfilesIndex) -> bool {
    let Some(data_dir) = super::paths::data_dir() else {
        return false;
    };
    let profiles_dir = data_dir.join("profiles");
    let Ok(entries) = std::fs::read_dir(&profiles_dir) else {
        return false;
    };

    let mut added = false;
    let now = Utc::now().timestamp();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let Some(dir_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };

        if dir_name == DEFAULT_PROFILE_ID {
            continue;
        }

        if index.profiles.iter().any(|p| p.id == dir_name) {
            continue;
        }

        let settings_path = path.join(super::paths::SETTINGS_FILE_NAME);
        if !settings_path.exists() {
            continue;
        }

        let settings = load_settings_for_profile(dir_name);
        let name = settings
            .user_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(dir_name)
            .to_string();

        index.profiles.push(Profile {
            id: dir_name.to_string(),
            name,
            local_user_id: settings.user_id.unwrap_or_default(),
            api_base_url: settings.api_base_url.unwrap_or_default(),
            ws_base_url: settings.ws_base_url.unwrap_or_default(),
            profile_avatar_url: settings.profile_avatar,
            created_at: now,
            last_used: now,
            cloud_host_api_base_urls: settings.cloud_host_api_base_urls,
            cloud_host_ws_base_urls: settings.cloud_host_ws_base_urls,
            custom_scan_paths: settings.custom_scan_paths,
            keep_backups_per_game: settings.keep_backups_per_game,
            full_backup_streaming: settings.full_backup_streaming,
            full_backup_streaming_dry_run: settings.full_backup_streaming_dry_run,
            full_backup_packaged_compression_level: settings.full_backup_packaged_compression_level,
            default_source_download_dir: settings.default_source_download_dir,
            profile_background: settings.profile_background,
            profile_frame: settings.profile_frame,
            share_visual_profile_with_hosts: settings.share_visual_profile_with_hosts,
            share_visual_profile_with_members: settings.share_visual_profile_with_members,
            auto_extract_downloads: settings.auto_extract_downloads,
        });
        added = true;
    }

    added
}
