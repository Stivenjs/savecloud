mod commands;
mod compat;
mod config;
mod notifications;
mod controller;
mod ipc;
#[cfg(target_os = "windows")]
mod manifest;
mod network;
mod plugins;
mod setup;
mod sqlite;
mod sources;
mod steam;
mod steam_cache;
mod steam_catalog;
mod system;
mod time;
mod torrent;
mod tray;
mod utils;
mod overlay;
use tauri::Manager;

fn load_dotenv() {
    let _ = dotenvy::dotenv();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dotenv();

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder = ipc::handlers::register_all_commands(builder);

    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .setup(|app| {
            tray::create_tray(app)?;

            setup::init_states_and_background_tasks(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
