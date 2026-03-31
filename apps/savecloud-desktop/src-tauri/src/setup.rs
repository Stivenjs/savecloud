//! Módulo de inicialización central de la aplicación.
//!
//! Orquesta el arranque de todos los subsistemas en segundo plano necesarios
//! para el funcionamiento de SaveCloud, incluyendo la gestión de plugins,
//! el motor de descargas P2P (Torrent), la vigilancia de procesos y los
//! demonios de sincronización automática.

use crate::system::game_exit_sync;
//use crate::system::watch_sync;
use crate::controller::start_gamepad_loop;
use crate::plugins::{log_buffer::new_log_buffer, AppPluginManager};
use crate::sqlite::AppDb;
use crate::system::process_check::start_process_watcher;
use crate::torrent::{engine::TorrentEngine, state::TorrentState};
use crate::tray::tray_state::TrayState;

use std::sync::Arc;
use tauri::{App, Manager};
use tokio::sync::Mutex;

/// Ejecuta la secuencia de arranque de los demonios y vincula los estados globales.
///
/// # Arguments
///
/// * `app` - Referencia mutable a la instancia principal de la aplicación Tauri.
pub fn init_states_and_background_tasks(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Herramientas de desarrollo
    // Habilitar DevTools automáticamente en el frontend si compilamos en modo debug.
    #[cfg(debug_assertions)]
    {
        if let Some(window) = app.get_webview_window("main") {
            window.open_devtools();
        }
    }

    // 2. Inicialización del sistema de Plugins
    let plugins_dir = app
        .path()
        .data_dir()
        .map(|base| base.join("SaveCloud").join("plugins"))
        .unwrap_or_else(|_| std::env::current_dir().unwrap().join("plugins"));

    if !plugins_dir.exists() {
        let _ = std::fs::create_dir_all(&plugins_dir);
    }

    let db = AppDb::open()?;
    db.ping()?;
    app.manage(db);

    let logs = new_log_buffer();
    app.manage(logs.clone());

    let shared_manager: AppPluginManager =
        Arc::new(Mutex::new(crate::plugins::manager::PluginManager::new()));
    app.manage(shared_manager.clone());

    let tokio_handle = tauri::async_runtime::handle();
    let handle = app.handle().clone();

    // La carga de plugins se delega a un hilo de fondo para no bloquear
    // el renderizado inicial de la interfaz de usuario.
    std::thread::spawn(move || {
        let mut manager = crate::plugins::manager::PluginManager::new();
        manager.load_all(plugins_dir, handle, logs);

        tokio_handle.block_on(async {
            *shared_manager.lock().await = manager;
        });
    });

    // 3. Inicialización del motor P2P (BitTorrent)
    let torrent_engine = tauri::async_runtime::block_on(TorrentEngine::new(
        std::env::temp_dir().join("SaveCloud-torrents"),
    ))
    .expect("fallo crítico al inicializar TorrentEngine");

    app.manage(TorrentState {
        engine: std::sync::Arc::new(tokio::sync::Mutex::new(torrent_engine)),
    });
    app.manage(crate::sources::queue::SourcesState::new_from_disk());

    // 4. Extracción de estados compartidos
    let tray_state = app.state::<TrayState>();

    // 5. Arranque de los observadores y demonios en segundo plano

    // Sincronización Reactiva: Sube archivos cuando detecta que el proceso de un juego termina.
    game_exit_sync::spawn_exit_watcher(app.handle().clone(), tray_state.inner().0.clone());

    // Sincronización Activa (Nuestro nuevo módulo): Vigila cambios en el disco duro
    // y los encola con un debounce de 5 minutos para subidas silenciosas.
    // comentado temporalmente para evitar bugs:
    // watch_sync::spawn_watcher(app.handle().clone(), tray_state.inner().0.clone());

    // Observador de Procesos: Audita la memoria del SO y emite eventos IPC al frontend.
    start_process_watcher(app.handle().clone());

    // Bucle del Controlador: Inicia la escucha activa de inputs de mandos/gamepads.
    start_gamepad_loop(app.handle().clone());

    Ok(())
}
