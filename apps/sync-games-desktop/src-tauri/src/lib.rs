mod commands;
mod config;
#[cfg(target_os = "windows")]
mod manifest;
mod process_check;
mod steam;
mod torrent;
mod tray_state;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager};

fn load_dotenv() {
    let _ = dotenvy::dotenv();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dotenv();
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .invoke_handler(tauri::generate_handler![
            torrent::commands::start_torrent_download,
            torrent::commands::start_torrent_file_download,
            torrent::commands::cancel_torrent,
            commands::get_config,
            commands::get_config_path,
            commands::create_config_file,
            commands::set_keep_backups_per_game,
            commands::set_full_backup_streaming,
            commands::set_full_backup_streaming_dry_run,
            commands::get_steam_app_name,
            commands::get_steam_appdetails_media,
            commands::get_steam_appdetails_media_batch,
            commands::search_steam_app_id,
            commands::search_steam_app_ids_batch,
            commands::search_steam_games,
            commands::search_manifest_games,
            commands::add_game,
            commands::update_game,
            commands::rename_game,
            commands::remove_game,
            commands::read_image_as_data_url,
            commands::scan_path_candidates,
            commands::sync::list_save_files,
            commands::sync::upload::request_upload_cancel,
            commands::sync::upload::request_upload_pause,
            commands::sync::upload::get_paused_upload_info,
            commands::sync::upload::sync_upload_resume,
            commands::sync::upload::sync_upload_game,
            commands::sync::upload::sync_upload_all_games,
            commands::sync::api::sync_list_remote_saves,
            commands::sync::api::sync_delete_game_from_cloud,
            commands::sync::api::sync_rename_game_in_cloud,
            commands::sync::download::sync_check_download_conflicts,
            commands::sync::download::sync_check_download_conflicts_batch,
            commands::sync::download::sync_download_game,
            commands::sync::download::sync_download_all_games,
            commands::sync::download::sync_check_unsynced_games,
            commands::sync::backup::list_backups,
            commands::sync::backup::restore_backup,
            commands::sync::backup::cleanup_old_backups,
            commands::sync::backup::delete_all_local_backups,
            commands::sync::full_backup::create_and_upload_full_backup,
            commands::sync::full_backup::list_full_backups,
            commands::sync::full_backup::list_full_backups_batch,
            commands::sync::full_backup::download_and_restore_full_backup,
            commands::sync::full_backup::delete_cloud_backup,
            commands::sync::full_backup::rename_cloud_backup,
            commands::sync::preview::preview_upload,
            commands::sync::preview::preview_download,
            commands::get_game_stats,
            commands::sync::check_game_running,
            commands::sync::check_games_running,
            commands::sync::get_sync_debug_log_path,
            commands::open_save_folder,
            commands::export_config_to_file,
            commands::import_config_from_file,
            commands::import_friend_config,
            commands::backup_config_to_cloud,
            commands::restore_config_from_cloud,
            commands::sync::api::sync_list_remote_saves_for_user,
            commands::get_friend_config,
            commands::add_games_from_friend,
            commands::sync::api::copy_friend_saves,
            commands::sync::api::copy_friend_saves_with_plan,
            commands::sync::api::get_s3_transfer_endpoint_type,
            commands::list_operation_history,
            commands::tray_tooltip::refresh_tray_tooltip,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            let icon_bytes = include_bytes!("../icons/icon.ico");
            let icon = tauri::image::Image::from_bytes(icon_bytes)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

            let show_item = MenuItem::with_id(app, "show", "Mostrar", true, None::<&str>)?;
            let upload_all_item =
                MenuItem::with_id(app, "upload_all", "Subir todo ahora", true, None::<&str>)?;
            let download_all_item = MenuItem::with_id(
                app,
                "download_all",
                "Descargar todo ahora",
                true,
                None::<&str>,
            )?;
            let backup_first_item = MenuItem::with_id(
                app,
                "backup_first",
                "Backup completo (primer juego)",
                true,
                None::<&str>,
            )?;
            let quit_item = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &upload_all_item,
                    &download_all_item,
                    &backup_first_item,
                    &quit_item,
                ],
            )?;

            let tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Listo")
                .on_menu_event(move |app, event| {
                    let id = event.id.as_ref();
                    if id == "show" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    } else if id == "quit" {
                        app.exit(0);
                    } else if id == "upload_all" {
                        let _ = app.emit("tray-action-upload-all", ());
                    } else if id == "download_all" {
                        let _ = app.emit("tray-action-download-all", ());
                    } else if id == "backup_first" {
                        let _ = app.emit("tray-action-backup-first", ());
                    }
                })
                .build(app)?;

            let tray_state = tray_state::TrayState::new(tray);
            app.manage(tray_state.clone());

            app.manage(torrent::state::TorrentState {
                engine: std::sync::Arc::new(tokio::sync::Mutex::new(
                    tauri::async_runtime::block_on(torrent::engine::TorrentEngine::new(
                        std::env::temp_dir().join("sync-games-torrents"),
                    )),
                )),
                app_handle: app.handle().clone(),
            });

            // Auto-sync al cambiar archivos deshabilitado por ahora (no subir tras restaurar empaquetado).
            // commands::watch_sync::spawn_watcher(app.handle().clone(), tray_state.0.clone());
            commands::game_exit_sync::spawn_exit_watcher(
                app.handle().clone(),
                tray_state.0.clone(),
            );

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
