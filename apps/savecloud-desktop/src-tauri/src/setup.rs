//! Módulo para inicializar los estados y las tareas en segundo plano.
use crate::commands::game_exit_sync;
use crate::controller::start_gamepad_loop;
use crate::process_check::start_process_watcher;
use crate::torrent::{engine::TorrentEngine, state::TorrentState};
use crate::tray_state::TrayState;
use tauri::{App, Manager};

/// Inicializa los estados y las tareas en segundo plano.
pub fn init_states_and_background_tasks(app: &mut App) {
    #[cfg(debug_assertions)]
    {
        if let Some(window) = app.get_webview_window("main") {
            window.open_devtools();
        }
    }

    app.manage(TorrentState {
        engine: std::sync::Arc::new(tokio::sync::Mutex::new(tauri::async_runtime::block_on(
            TorrentEngine::new(std::env::temp_dir().join("SaveCloud-torrents")),
        ))),
        app_handle: app.handle().clone(),
    });

    let tray_state = app.state::<TrayState>();

    game_exit_sync::spawn_exit_watcher(app.handle().clone(), tray_state.inner().0.clone());
    start_process_watcher(app.handle().clone());
    start_gamepad_loop(app.handle().clone());
}
