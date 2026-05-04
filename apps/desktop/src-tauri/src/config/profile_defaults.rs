use super::profile_storage::load_settings_raw;
use super::profiles::{Profile, ProfilesIndex, DEFAULT_PROFILE_ID};
use chrono::Utc;

pub fn build_default_profile() -> Profile {
    let settings = load_settings_raw();
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
    }
}

pub fn ensure_default_profile(index: &mut ProfilesIndex) -> bool {
    if index.get_profile(DEFAULT_PROFILE_ID).is_some() {
        if index.active_profile_id.trim().is_empty() {
            index.active_profile_id = DEFAULT_PROFILE_ID.to_string();
        }
        return false;
    }

    index.profiles.insert(0, build_default_profile());
    if index.active_profile_id.trim().is_empty() {
        index.active_profile_id = DEFAULT_PROFILE_ID.to_string();
    }
    true
}
