//! Módulo de inicialización central de la aplicación.
//!
//! Orquesta el arranque de todos los subsistemas en segundo plano necesarios
//! para el funcionamiento de SaveCloud, incluyendo la gestión de plugins,
//! el motor de descargas P2P (Torrent), la vigilancia de procesos y los
//! demonios de sincronización automática.

use crate::system::game_exit_sync;
//use crate::system::watch_sync;
use crate::cloud;
use crate::config::storage_layout::ensure_storage_layout;
use crate::controller::start_gamepad_loop;
use crate::plugins::{log_buffer::new_log_buffer, manager::PluginManager, AppPluginManager};
use crate::shutdown::coordinator::ShutdownPhase;
use crate::shutdown::{ShutdownBus, ShutdownCoordinator, ShutdownGuard};
use crate::sources::commands;
use crate::sources::queue;
use crate::sqlite::AppDb;
use crate::system::process_check;
use crate::torrent::{engine::TorrentEngine, state::TorrentState};
use crate::tray::tray_state::TrayState;
use crate::voice::VoiceState;
use std::sync::Arc;
use tauri::{App, Manager};
use tokio::sync::Mutex;

/// Wrapper de estado de Tauri para el guard del TorrentSession.
///
/// Se registra con `app.manage()` para que `engine.rs` pueda completarlo
/// cuando la última sesión de librqbit queda vacía al cerrar.
pub struct TorrentShutdownGuard(pub std::sync::Mutex<Option<ShutdownGuard>>);

/// Ejecuta la secuencia de arranque de los demonios y vincula los estados globales.
///
/// # Arguments
///
/// * `app` - Referencia mutable a la instancia principal de la aplicación Tauri.
pub fn init_states_and_background_tasks(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    ensure_storage_layout()
        .map_err(|error| format!("No se pudo preparar storage layout: {error}"))?;

    // 1. Herramientas de desarrollo
    #[cfg(debug_assertions)]
    {
        if let Some(window) = app.get_webview_window("main") {
            window.open_devtools();
        }
    }

    let shutdown_bus = ShutdownBus::new();
    let coordinator = ShutdownCoordinator::new(shutdown_bus.clone());

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

    // 4. Hilo de mantenimiento de la base de datos (periódico + cierre limpio)
    {
        let (guard, handle) = ShutdownGuard::new("sqlite_maintenance", &shutdown_bus.token());
        let coord = coordinator.clone();
        tauri::async_runtime::block_on(async move {
            coord.register(ShutdownPhase::Cleanup, handle).await;
        });

        tauri::async_runtime::spawn(async move {
            let token = guard.token();
            let mut ticker = tokio::time::interval(std::time::Duration::from_secs(15 * 60));
            ticker.tick().await;

            loop {
                tokio::select! {
                    _ = token.cancelled() => {
                        let _ = db_for_maintenance.checkpoint_truncate();
                        let _ = db_for_maintenance.compact_if_fragmented(
                            AppDb::DEFAULT_MIN_PAGES_FOR_COMPACTION,
                            AppDb::DEFAULT_FRAGMENTATION_THRESHOLD_PERCENT,
                        );
                        guard.complete();
                        break;
                    }
                    _ = ticker.tick() => {
                        let _ = db_for_maintenance.compact_if_fragmented(
                            AppDb::DEFAULT_MIN_PAGES_FOR_COMPACTION,
                            AppDb::DEFAULT_FRAGMENTATION_THRESHOLD_PERCENT,
                        );
                    }
                }
            }
        });
    }

    // 4.5 Ventana abstracta Overlay para notificaciones
    let _ = crate::overlay::setup_overlay_window(&app.handle());

    // 5. Buffer de logs y plugin manager
    let logs = new_log_buffer();
    app.manage(logs.clone());

    let shared_manager: AppPluginManager = Arc::new(Mutex::new(PluginManager::new()));
    app.manage(shared_manager.clone());

    let tokio_handle = tauri::async_runtime::handle();
    let handle = app.handle().clone();

    std::thread::spawn(move || {
        let mut manager = PluginManager::new();
        manager.load_all(plugins_dir, handle, logs);
        tokio_handle.block_on(async {
            *shared_manager.lock().await = manager;
        });
    });

    // 6. Inicialización del motor P2P (BitTorrent)
    let temp_base = std::env::temp_dir();
    let current_timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let session_name = format!("SaveCloud-torrents-{}", current_timestamp);
    let torrent_dir = temp_base.join(&session_name);
    let session_name_for_cleaner = session_name.clone();

    std::thread::spawn(move || {
        if let Ok(entries) = std::fs::read_dir(&temp_base) {
            for entry in entries.flatten() {
                let file_name = entry.file_name();
                let name_str = file_name.to_string_lossy();
                if name_str.starts_with("SaveCloud-torrents-")
                    && name_str != session_name_for_cleaner
                {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    });

    let torrent_engine =
        tauri::async_runtime::block_on(async { TorrentEngine::new(torrent_dir).await })
            .map_err(|e| format!("No se pudo inicializar TorrentEngine: {e}"))?;

    app.manage(TorrentState {
        engine: std::sync::Arc::new(tokio::sync::Mutex::new(torrent_engine)),
    });

    if let Err(e) = commands::init_match_config(0.58) {
        log::warn!(
        "[Setup] No se pudieron cargar las stopwords embebidas. El motor de búsqueda funcionará con valores por defecto. Error: {}",
        e
    );
    }

    app.manage(queue::SourcesState::new_from_disk());
    app.manage(cloud::CloudWsState::new());
    app.manage(VoiceState::default());

    queue::resume_pending_jobs(&app.handle());

    // 7. Estados compartidos del tray
    let tray_state = app.state::<TrayState>();

    {
        let (guard, handle) = ShutdownGuard::new("process_watcher", &shutdown_bus.token());
        let coord = coordinator.clone();
        tauri::async_runtime::block_on(async move {
            coord.register(ShutdownPhase::UiAndWatchers, handle).await;
        });

        let token = guard.token();
        let app_handle = app.handle().clone();

        tauri::async_runtime::spawn(async move {
            process_check::run_watcher_loop_with_token(&app_handle, token).await;
            guard.complete();
        });
    }

    {
        let (guard, handle) = ShutdownGuard::new("game_exit_sync", &shutdown_bus.token());
        let coord = coordinator.clone();
        tauri::async_runtime::block_on(async move {
            coord.register(ShutdownPhase::BackgroundTasks, handle).await;
        });

        let tray_inner = tray_state.inner().0.clone();
        let app_handle = app.handle().clone();
        let token = guard.token();

        tauri::async_runtime::spawn(async move {
            game_exit_sync::spawn_exit_watcher(app_handle, tray_inner);

            token.cancelled().await;
            guard.complete();
        });
    }

    {
        let (guard, handle) = ShutdownGuard::new("torrent_session", &shutdown_bus.token());
        let coord = coordinator.clone();
        tauri::async_runtime::block_on(async move {
            coord.register(ShutdownPhase::TorrentSession, handle).await;
        });

        app.manage(TorrentShutdownGuard(std::sync::Mutex::new(Some(guard))));
    }

    app.manage(shutdown_bus);
    app.manage(coordinator);

    // 8. Controlador de gamepads (no necesita guard: es stateless)
    start_gamepad_loop(app.handle().clone());

    Ok(())
}
