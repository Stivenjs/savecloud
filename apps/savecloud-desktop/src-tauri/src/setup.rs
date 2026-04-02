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

    // 3. Inicialización de la base de datos SQLite
    let db = AppDb::open()?;
    db.ping()?;

    let db_for_maintenance = db.clone();

    app.manage(db);
    // 4. Inicialización del hilo de mantenimiento de la base de datos
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;

        if let Ok((total, free)) = db_for_maintenance.stats() {
            if total > 0 {
                let fragmentation = (free as f64 / total as f64) * 100.0;

                if fragmentation > 25.0 && total > 500 {
                    println!(
                        "Optimizando base de datos... ({:.2}% fragmentación)",
                        fragmentation
                    );
                    let _ = db_for_maintenance.compact();
                }
            }
        }
    });

    // 5. Inicialización del buffer de logs
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

    // 6. Inicialización del motor P2P (BitTorrent)
    let torrent_engine = tauri::async_runtime::block_on(TorrentEngine::new(
        std::env::temp_dir().join("SaveCloud-torrents"),
    ))
    .expect("fallo crítico al inicializar TorrentEngine");

    app.manage(TorrentState {
        engine: std::sync::Arc::new(tokio::sync::Mutex::new(torrent_engine)),
    });
    app.manage(crate::sources::queue::SourcesState::new_from_disk());

    // 7. Extracción de estados compartidos
    let tray_state = app.state::<TrayState>();

    // 8. Arranque de los observadores y demonios en segundo plano

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
