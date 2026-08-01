//! Integración con los hooks de ciclo de vida de Tauri.
//!
//! Este módulo conecta el sistema de shutdown con los eventos de Tauri:
//! cuando el usuario cierra la última ventana (o desde el systray), se dispara
//! el coordinador de cierre en lugar de dejar que Tauri salga inmediatamente.
//!
//! # Por qué necesitamos esto
//!
//! Tauri por defecto destruye el runtime de Tokio en cuanto todas las ventanas
//! se cierran. Esto mata el proceso abruptamente sin dar tiempo a que los hilos
//! blocking terminen, lo que produce el síntoma de "app zombie" que sigue viva
//! en el administrador de tareas aunque la ventana haya desaparecido.
//!
//! La solución es interceptar `CloseRequested`, **prevenir el cierre inmediato**,
//! ejecutar el shutdown coordinado en una tarea async, y solo entonces llamar
//! a `std::process::exit(0)` cuando todo esté limpio.
//!
//! # Uso en main.rs
//!
//! ```rust,no_run
//! use crate::shutdown::{ShutdownBus, ShutdownCoordinator, register_shutdown_hook};
//!
//! fn main() {
//!     let shutdown_bus = ShutdownBus::new();
//!     let coordinator = ShutdownCoordinator::new(shutdown_bus.clone());
//!
//!     tauri::Builder::default()
//!         .manage(shutdown_bus)
//!         .manage(coordinator.clone())
//!         .setup(|app| {
//!             // Registrar subsistemas aquí con sus guards...
//!             Ok(())
//!         })
//!         .on_window_event(register_shutdown_hook)
//!         .run(tauri::generate_context!())
//!         .expect("Error ejecutando Tauri");
//! }
//! ```

use std::time::{Duration, Instant};

use tauri::{AppHandle, Manager, WindowEvent};

use crate::torrent::shutdown_idle::complete_torrent_shutdown_guard_if_idle;

use super::coordinator::ShutdownCoordinator;
use super::splash::{
    arm_shutdown_splash_mount_ack, show_shutdown_splash_window, signal_shutdown_splash_mounted,
};

use super::coordinator::ShutdownPhase;

/// Indica si hay operaciones pesadas de red, torrents o sincronización en ejecución.
pub async fn has_active_heavy_work(app: &AppHandle) -> bool {
    if let Some(torrent_state) = app.try_state::<crate::torrent::state::TorrentState>() {
        let active_count = torrent_state.engine.lock().await.active_hashes().len();
        if active_count > 0 {
            return true;
        }
    }

    if let Some(coordinator) = app.try_state::<ShutdownCoordinator>() {
        if coordinator
            .has_active_phase_work(ShutdownPhase::NetworkUploads)
            .await
        {
            return true;
        }
    }

    false
}

/// Salida desde el ícono de bandeja / menú.
///
/// Si existen tareas pesadas activas en segundo plano (ej. subidas S3 o torrents),
/// muestra el splash informativo durante el tiempo necesario para la limpieza.
/// Si la aplicación está inactiva, ejecuta el cierre ultra-rápido al instante.
pub async fn quit_from_tray_with_splash(app: AppHandle) {
    log::info!("[Tray] Flujo Salir solicitado...");

    let is_heavy = has_active_heavy_work(&app).await;

    if is_heavy {
        log::info!(
            "[Tray] Operaciones activas detectadas. Mostrando ventana informativa de cierre..."
        );
        let splash_clock = Instant::now();
        let mount_rx = arm_shutdown_splash_mount_ack();

        let app_for_main = app.clone();
        let schedule = app.run_on_main_thread(move || {
            if let Err(e) = show_shutdown_splash_window(&app_for_main) {
                log::warn!(
                    "[Tray] No se pudo mostrar ventana de cierre desde hilo principal: {}",
                    e
                );
                signal_shutdown_splash_mounted();
            }
        });

        if let Err(e) = schedule {
            log::warn!("[Tray] run_on_main_thread falló ({e}); creando ventana directamente.");
            let _ = show_shutdown_splash_window(&app);
            signal_shutdown_splash_mounted();
        }

        tokio::select! {
            _ = mount_rx => {
                log::debug!("[Tray] Splash de cierre lista (front ACK).");
            }
            _ = tokio::time::sleep(Duration::from_millis(1200)) => {
                log::warn!("[Tray] Timeout esperando splash; continuando con shutdown.");
            }
        }

        let pending = Duration::from_millis(1200).saturating_sub(splash_clock.elapsed());
        if !pending.is_zero() {
            tokio::time::sleep(pending).await;
        }
    } else {
        log::info!("[Tray] Sin operaciones activas. Ejecutando cierre ultra-rápido al instante...");
    }

    execute_graceful_shutdown(app).await;
}

/// ACK desde la webview `shutdown-window` cuando ya montó UI (splash visible).
#[tauri::command]
pub fn shutdown_splash_mounted() {
    signal_shutdown_splash_mounted();
}

/// Handler para registrar en `tauri::Builder::on_window_event`.
///
/// Intercepta el evento `CloseRequested` de la última ventana y ejecuta
/// el cierre coordinado antes de permitir que el proceso salga.
///
/// # Comportamiento ante múltiples ventanas
///
/// Si la aplicación tiene varias ventanas, el shutdown solo se dispara cuando
/// **todas** las ventanas han sido cerradas. Las ventanas intermedias se cierran
/// normalmente sin disparar el shutdown.
///
/// Para una app de una sola ventana (como SaveCloud), el shutdown se dispara
/// siempre que el usuario cierra la ventana principal.
pub fn register_shutdown_hook(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let app = window.app_handle().clone();

        // Prevenir que Tauri cierre la ventana y el proceso inmediatamente.
        // Esto nos da control sobre el timing del cierre.
        api.prevent_close();

        // Ejecutar el shutdown coordinado en una tarea async separada para
        // no bloquear el thread del event loop de Tauri.
        tauri::async_runtime::spawn(async move {
            execute_graceful_shutdown(app).await;
        });
    }
}

/// Ejecuta la secuencia completa de cierre seguro y termina el proceso.
///
/// Esta función:
/// 1. Obtiene el coordinador del estado de Tauri.
/// 2. Ejecuta todas las fases del shutdown en orden.
/// 3. Llama a `std::process::exit(0)` cuando todo está limpio.
///
/// Si el coordinador no está registrado en el estado de Tauri (error de
/// configuración en main.rs), registra el error y fuerza la salida de todos modos.
async fn execute_graceful_shutdown(app: AppHandle) {
    log::info!("[Shutdown] Cierre de ventana detectado. Iniciando secuencia de cierre seguro...");

    // Sin torrents activos el guard quedaba esperando hasta el timeout completo de fase.
    complete_torrent_shutdown_guard_if_idle(&app).await;

    // Obtener el coordinador del estado gestionado de Tauri.
    match app.try_state::<ShutdownCoordinator>() {
        Some(coordinator) => {
            coordinator.run_shutdown().await;
        }
        None => {
            // Esto indica un error de configuración: el coordinador no fue
            // registrado con `app.manage(coordinator)` en main.rs.
            log::error!(
                "[Shutdown] ERROR: ShutdownCoordinator no está registrado en el estado de Tauri. \
                 Verifica que main.rs llame a .manage(coordinator). Forzando salida de emergencia."
            );
        }
    }

    // Ejecutar checkpoint TRUNCATE del WAL de SQLite para compactar el archivo en disco al salir
    if let Some(db) = app.try_state::<crate::sqlite::AppDb>() {
        if let Err(e) = db.checkpoint_truncate() {
            log::warn!(
                "[Shutdown] No se pudo hacer checkpoint del WAL de SQLite al cerrar: {}",
                e
            );
        } else {
            log::info!("[Shutdown] Checkpoint WAL TRUNCATE de SQLite completado limpiamente.");
        }
    }

    log::info!("[Shutdown] Secuencia completada. Saliendo del proceso.");

    // Salida limpia del proceso. En este punto todos los subsistemas han
    // confirmado su terminación (o han expirado sus timeouts).
    std::process::exit(0);
}

/// Comando Tauri para solicitar el cierre desde el frontend (ej. botón "Salir").
///
/// Equivalente a cerrar la ventana pero iniciado programáticamente desde la UI.
/// Útil para implementar "Salir" en menús contextuales del systray.
///
/// # Ejemplo en TypeScript
///
/// ```typescript
/// import { invoke } from '@tauri-apps/api/core';
/// await invoke('request_app_shutdown');
/// ```
#[tauri::command]
pub async fn request_app_shutdown(app: AppHandle) {
    log::info!("[Shutdown] Cierre solicitado desde el frontend.");
    execute_graceful_shutdown(app).await;
}
