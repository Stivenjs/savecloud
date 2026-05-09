//! Orquestación activar/desactivar modo juego (SaveCloud + SO).

use tauri::{AppHandle, Manager};

use crate::config::models::AppSettings;
use crate::config::{self};
use crate::sources::commands as source_commands;
use crate::sources::domain::SourceJobStatus;
use crate::torrent::{engine, state::TorrentState};
use crate::tray::tray_state::TrayState;

use super::session_file::{self as sf, GameModeSessionFile};

fn settings_from_disk() -> AppSettings {
    config::load_settings()
}

/// Si hay sesión huérfana tras un cierre abrupto pero el modo figura como desactivado, restauramos el SO.
pub async fn reconcile_orphans(app: AppHandle) {
    let s = settings_from_disk();
    if s.game_mode_enabled {
        let _ = apply_enable_follow_prefs(&app, &s).await;
        return;
    }

    let session = sf::load_session();
    let has_os_residual = session.windows_previous_power_scheme_guid.is_some()
        || session.linux_power_profile_before.is_some()
        || session.macos_caffeinate_pid.is_some()
        || session.windows_capture_changed;

    if has_os_residual {
        log::warn!(
            "[GameMode] Sesión huérfana detectada — restaurando estado de energía/grabación en el sistema"
        );
        deactivate_os_changes(&session).await;
        let mut cleared = session;
        deactivate_clear_os_fields(&mut cleared);
        persist_after_change(&cleared);
    }
}

fn persist_after_change(sess: &GameModeSessionFile) {
    if session_is_totally_clear(sess) {
        let _ = sf::clear_session_file();
        return;
    }
    if let Err(e) = sf::save_session(sess) {
        log::warn!("[GameMode] No se persistió sesión: {e}");
    }
}

fn session_is_totally_clear(s: &GameModeSessionFile) -> bool {
    !s.upload_pause_caused_by_mode
        && s.paused_source_jobs.is_empty()
        && s.paused_torrents.is_empty()
        && s.windows_previous_power_scheme_guid.is_none()
        && s.linux_power_profile_before.is_none()
        && s.macos_caffeinate_pid.is_none()
        && !s.windows_capture_changed
}

pub async fn set_enabled(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut cfg = settings_from_disk();
    if cfg.game_mode_enabled == enabled {
        return Ok(());
    }

    if enabled {
        apply_enable_follow_prefs(&app, &cfg).await?;
        cfg.game_mode_enabled = true;
    } else {
        apply_disable(app.clone(), &cfg).await?;
        cfg.game_mode_enabled = false;
    }

    config::save_settings(&cfg).map_err(|e| format!("guardar settings modo juego: {e}"))
}

pub async fn refresh_if_enabled(app: AppHandle) -> Result<(), String> {
    let cfg = settings_from_disk();
    if !cfg.game_mode_enabled {
        return Ok(());
    }
    apply_enable_follow_prefs(&app, &cfg).await
}

async fn apply_enable_follow_prefs(app: &AppHandle, prefs: &AppSettings) -> Result<(), String> {
    let mut sess = sf::load_session();

    if prefs.game_mode_throttle_savecloud_background {
        throttle_savecloud_on(app, &mut sess).await;
    }

    apply_os_energy_on(app, prefs, &mut sess).await?;

    sf::save_session(&sess)?;
    Ok(())
}

async fn apply_disable(app: AppHandle, prefs: &AppSettings) -> Result<(), String> {
    let mut sess = sf::load_session();

    deactivate_os_changes(&sess).await;
    deactivate_clear_os_fields(&mut sess);

    sf::save_session(&sess)?;

    if prefs.game_mode_throttle_savecloud_background {
        throttle_savecloud_off(&app, &mut sess).await;
    }

    persist_after_change(&sess);
    Ok(())
}

fn deactivate_clear_os_fields(s: &mut GameModeSessionFile) {
    s.windows_previous_power_scheme_guid = None;
    s.linux_power_profile_before = None;
    s.macos_caffeinate_pid = None;
    s.windows_capture_changed = false;
    s.windows_capture_key_was_missing = false;
    s.windows_game_dvr_capture_before = None;
}

async fn throttle_savecloud_on(app: &AppHandle, sess: &mut GameModeSessionFile) {
    let tray: tauri::State<'_, TrayState> = match app.try_state::<TrayState>() {
        Some(t) => t,
        None => {
            log::warn!("[GameMode] TrayState no disponible; omitiendo pausa subida.");
            return;
        }
    };
    let was_paused = tray.0.upload_pause_requested();
    if !was_paused {
        tray.0.request_upload_pause();
        sess.upload_pause_caused_by_mode = true;
    }

    let torrent_state: tauri::State<'_, TorrentState> = match app.try_state::<TorrentState>() {
        Some(t) => t,
        None => {
            log::warn!("[GameMode] TorrentState no disponible");
            return;
        }
    };

    let hashes: Vec<String> = {
        let eng = torrent_state.engine.lock().await;
        eng.active_hashes()
    };
    for hash in hashes {
        if sess.paused_torrents.contains(&hash) {
            continue;
        }
        let session = {
            let eng = torrent_state.engine.lock().await;
            eng.session()
        };
        if engine::pause_via_session(&session, &hash).await.is_ok() {
            sess.paused_torrents.push(hash);
        }
    }

    let sources_state: tauri::State<'_, crate::sources::queue::SourcesState> =
        match app.try_state::<crate::sources::queue::SourcesState>() {
            Some(t) => t,
            None => return,
        };
    for j in sources_state.list_jobs() {
        if matches!(j.status, SourceJobStatus::Running)
            && !sess.paused_source_jobs.contains(&j.job_id)
        {
            match source_commands::pause_source_download(j.job_id.clone(), app.clone()).await {
                Ok(()) => sess.paused_source_jobs.push(j.job_id),
                Err(e) => log::warn!("[GameMode] Pausar job {}: {}", j.job_id, e),
            }
        }
    }
}

async fn throttle_savecloud_off(app: &AppHandle, sess: &mut GameModeSessionFile) {
    if sess.upload_pause_caused_by_mode {
        if let Some(tray) = app.try_state::<TrayState>() {
            tray.0.reset_upload_pause();
        }
        let had_paused = crate::commands::sync::upload::get_paused_upload_info().is_some();
        sess.upload_pause_caused_by_mode = false;
        if had_paused {
            let app_clone = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::commands::sync::upload::sync_upload_resume(app_clone).await {
                    log::warn!(
                        "[GameMode] multipart no reanudado automático: {}",
                        e.to_string()
                    );
                }
            });
        }
    }

    let torrent_state: tauri::State<'_, TorrentState> = match app.try_state::<TorrentState>() {
        Some(t) => t,
        None => {
            sess.paused_torrents.clear();
            return;
        }
    };
    let to_resume = std::mem::take(&mut sess.paused_torrents);
    for hash in to_resume {
        let session = {
            let eng = torrent_state.engine.lock().await;
            eng.session()
        };
        let _ = engine::resume_via_session(&session, &hash).await;
    }

    let job_ids = std::mem::take(&mut sess.paused_source_jobs);
    for job_id in job_ids {
        match source_commands::resume_source_download(job_id.clone(), app.clone()).await {
            Ok(()) => {}
            Err(e) => log::warn!("[GameMode] Reanudar job {}: {}", job_id, e),
        }
    }
}

#[cfg(target_os = "windows")]
async fn apply_os_energy_on(
    app: &AppHandle,
    prefs: &AppSettings,
    sess: &mut GameModeSessionFile,
) -> Result<(), String> {
    use super::os_windows::{
        activate_game_mode_windows_power_plan, get_active_power_scheme_guid, read_game_dvr_state,
        write_game_dvr_app_capture,
    };

    let _ = app;

    if prefs.game_mode_reduce_capture_overhead && !sess.windows_capture_changed {
        match read_game_dvr_state() {
            Ok(prev) => {
                sess.windows_capture_changed = true;
                match prev {
                    super::os_windows::DvrSnap::Absent => {
                        sess.windows_capture_key_was_missing = true;
                        sess.windows_game_dvr_capture_before = None;
                    }
                    super::os_windows::DvrSnap::Value(v) => {
                        sess.windows_capture_key_was_missing = false;
                        sess.windows_game_dvr_capture_before = Some(v);
                    }
                }
                if let Err(e) = write_game_dvr_app_capture(Some(0)) {
                    log::warn!("[GameMode] GameDVR capture off: {e}");
                }
            }
            Err(e) => log::warn!("[GameMode] DVR read: {e}"),
        }
    }

    if prefs.game_mode_apply_power_profile && sess.windows_previous_power_scheme_guid.is_none() {
        match get_active_power_scheme_guid() {
            Ok(cur) => {
                sess.windows_previous_power_scheme_guid = Some(cur.clone());
                if let Err(e) = activate_game_mode_windows_power_plan() {
                    log::warn!("[GameMode] powercfg Alto rendimiento: {e}");
                }
            }
            Err(e) => log::warn!("[GameMode] powercfg GUID activo: {e}"),
        }
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
async fn apply_os_energy_on(
    _app: &AppHandle,
    prefs: &AppSettings,
    sess: &mut GameModeSessionFile,
) -> Result<(), String> {
    use super::os_macos_linux::{
        read_linux_power_profile, set_linux_power_profile, start_caffeinate,
    };

    #[cfg(target_os = "macos")]
    if prefs.game_mode_apply_power_profile && sess.macos_caffeinate_pid.is_none() {
        match start_caffeinate() {
            Ok(pid) => sess.macos_caffeinate_pid = Some(pid),
            Err(e) => log::warn!("[GameMode] caffeinate: {e}"),
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = start_caffeinate();

    #[cfg(target_os = "linux")]
    if prefs.game_mode_apply_power_profile && sess.linux_power_profile_before.is_none() {
        sess.linux_power_profile_before = read_linux_power_profile();
        if let Err(e) = set_linux_power_profile("performance") {
            log::warn!("[GameMode] {e}");
        }
    }

    #[cfg(not(target_os = "linux"))]
    let _ = (read_linux_power_profile, set_linux_power_profile);

    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = prefs;

    Ok(())
}

#[cfg(target_os = "windows")]
async fn deactivate_os_changes(sess: &GameModeSessionFile) {
    use super::os_windows::{set_active_power_scheme, write_game_dvr_app_capture};

    if let Some(guid) = &sess.windows_previous_power_scheme_guid {
        if let Err(e) = set_active_power_scheme(guid.trim()) {
            log::warn!("[GameMode] Restaurar plan energía: {e}");
        }
    }

    if sess.windows_capture_changed {
        if sess.windows_capture_key_was_missing {
            let _ = write_game_dvr_app_capture(None);
        } else if let Some(v) = sess.windows_game_dvr_capture_before {
            let _ = write_game_dvr_app_capture(Some(v));
        }
    }
}

#[cfg(not(target_os = "windows"))]
async fn deactivate_os_changes(sess: &GameModeSessionFile) {
    #[cfg(target_os = "macos")]
    {
        if let Err(e) = super::os_macos_linux::stop_caffeinate(sess.macos_caffeinate_pid) {
            log::warn!("[GameMode] caffeinate stop: {e}");
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(ref prev) = sess.linux_power_profile_before {
            if let Err(e) = super::os_macos_linux::set_linux_power_profile(prev.trim()) {
                log::warn!("[GameMode] Restaurar powerprofile Linux: {}", e.to_string());
            }
        }
    }
}
