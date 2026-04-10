mod cloud;
mod commands;
mod compat;
mod config;
mod controller;
mod ipc;
#[cfg(target_os = "windows")]
mod manifest;
mod network;
mod notifications;
mod overlay;
mod plugins;
mod setup;
mod shutdown;
mod sources;
mod sqlite;
mod steam;
mod steam_cache;
mod steam_catalog;
mod system;
mod time;
mod torrent;
mod tray;
mod utils;
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
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // El hook de ventana ahora tiene dos responsabilidades:
        // 1. Ocultar la ventana (comportamiento existente para el systray).
        // 2. Si el cierre viene del systray o de un comando programático,
        //    el ShutdownCoordinator se encarga de la secuencia ordenada.
        //
        // IMPORTANTE: on_window_event se registra ANTES que el hook de shutdown
        // para que el hide() ocurra siempre, independientemente del coordinator.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Ocultar la ventana inmediatamente para que la UI desaparezca
                // sin esperar a que el coordinator termine todas las fases.
                let _ = window.hide();
                api.prevent_close();

                // Disparar el shutdown coordinado en una tarea async separada
                // para no bloquear el event loop de Tauri.
                let app = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    execute_graceful_shutdown(app).await;
                });
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

/// Ejecuta la secuencia completa de cierre seguro y termina el proceso.
///
/// Obtiene el ShutdownCoordinator del estado gestionado de Tauri y ejecuta
/// todas las fases en orden. Si el coordinator no está registrado (error de
/// configuración en setup.rs), fuerza la salida de todos modos para evitar
/// que el proceso quede zombie.
///
/// Esta función reemplaza el antiguo `api.prevent_close()` simple:
/// en lugar de matar el proceso abruptamente, espera a que cada subsistema
/// confirme su terminación dentro de su timeout de fase.
async fn execute_graceful_shutdown(app: tauri::AppHandle) {
    log::info!("[Shutdown] Cierre de ventana detectado. Iniciando secuencia de cierre seguro...");

    match app.try_state::<shutdown::ShutdownCoordinator>() {
        Some(coordinator) => {
            coordinator.run_shutdown().await;
        }
        None => {
            // Esto indica un error de configuración: el coordinator no fue
            // registrado con `app.manage(coordinator)` en setup.rs.
            log::error!(
                "[Shutdown] ERROR: ShutdownCoordinator no está registrado en el estado de Tauri. \
                 Verifica que setup.rs llame a app.manage(coordinator). Forzando salida de emergencia."
            );
        }
    }

    log::info!("[Shutdown] Secuencia completada. Saliendo del proceso.");

    // Salida limpia del proceso. En este punto todos los subsistemas han
    // confirmado su terminación (o han expirado sus timeouts).
    std::process::exit(0);
}
