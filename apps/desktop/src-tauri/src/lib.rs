mod cloud;
mod commands;
mod compat;
mod config;
mod controller;
mod devtools_cmds;
mod game_mode;
mod ipc;
#[cfg(target_os = "windows")]
mod manifest;
mod network;
mod notifications;
mod observability;
mod overlay;
mod peer_inventory;
mod peer_lan;
mod plugins;
mod setup;
mod shutdown;
mod sources;
mod sqlite;
mod steam;
mod steam_cache;
mod steam_catalog;
mod streaming;
mod system;
mod time;
mod torrent;
mod tray;
mod utils;
mod voice;
use tauri::Manager;

fn load_dotenv() {
    let _ = dotenvy::dotenv();
}

fn init_logging() {
    let filter = concat!("warn,", "savecloud_desktop_lib=info");
    let _ = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or(filter))
        .format_timestamp_millis()
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    load_dotenv();
    init_logging();

    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        #[cfg(not(debug_assertions))]
        {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }));
        }
    }

    builder = ipc::handlers::register_all_commands(builder);

    builder
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_os::init())
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
                let label = window.label();
                if label == "main" || label == "friends-window" || label == "settings-window" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            tray::create_tray(app)?;

            setup::init_states_and_background_tasks(app)?;

            app.manage(crate::game_mode::GameModeCtl::default());
            let game_mode_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                crate::game_mode::apply::reconcile_orphans(game_mode_handle).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
