mod commands;
mod config;
mod manifest;
mod process_check;
mod steam;
mod tray_state;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::Manager;

/// Carga .env desde el directorio de trabajo o directorios padres (como hace la CLI).
fn load_dotenv() {
    // Buscar .env ascendiendo desde el cwd (ej. raíz del repo al ejecutar `bun run desktop`)
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
            commands::get_config,
            commands::get_config_path,
            commands::create_config_file,
            commands::get_steam_app_name,
            commands::search_steam_app_id,
            commands::add_game,
            commands::remove_game,
            commands::scan_path_candidates,
            commands::sync::list_save_files,
            commands::sync::upload::sync_upload_game,
            commands::sync::api::sync_list_remote_saves,
            commands::sync::download::sync_check_download_conflicts,
            commands::sync::download::sync_download_game,
            commands::sync::download::sync_check_unsynced_games,
            commands::sync::backup::list_backups,
            commands::sync::backup::restore_backup,
            commands::sync::preview::preview_upload,
            commands::sync::preview::preview_download,
            commands::get_game_stats,
            commands::sync::check_game_running,
            commands::open_save_folder,
            commands::export_config_to_file,
            commands::import_config_from_file,
            commands::tray_tooltip::refresh_tray_tooltip,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Minimizar a bandeja en lugar de cerrar
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            // Crear icono desde bytes embebido (funciona en dev y producción)
            let icon_bytes = include_bytes!("../icons/icon.ico");
            let icon = tauri::image::Image::from_bytes(icon_bytes)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

            let show_item = MenuItem::with_id(app, "show", "Mostrar", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Listo")
                .on_menu_event(move |app, event| {
                    if event.id.as_ref() == "show" {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    } else if event.id.as_ref() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            let tray_state = tray_state::TrayState::new(tray);
            app.manage(tray_state.clone());
            commands::watch_sync::spawn_watcher(app.handle().clone(), tray_state.0.clone());
            commands::game_exit_sync::spawn_exit_watcher(
                app.handle().clone(),
                tray_state.0.clone(),
            );

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
