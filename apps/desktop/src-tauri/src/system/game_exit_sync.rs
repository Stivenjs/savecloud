//! Módulo de detección de cierre de juegos y subida automática de guardados.
//!
//! Detecta cuando un juego se cierra y dispara la subida automática de guardados.
//! Complementa el watcher de archivos: captura el guardado final al salir.
//! Escucha los eventos emitidos por `process_check` en lugar de hacer polling.

use crate::commands::sync;
use crate::config;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Listener};

/// Inicia la escucha de eventos de procesos en segundo plano para
/// subir los guardados automáticamente cuando un juego se cierra.
pub fn spawn_exit_watcher(app: AppHandle, tray_state: Arc<crate::tray::tray_state::TrayStateInner>) {
    let was_running: Arc<Mutex<HashMap<String, bool>>> = Arc::new(Mutex::new(HashMap::new()));

    let app_clone = app.clone();

    app.listen("games-running-status", move |event| {
        let cfg = config::load_config();
        if cfg
            .api_base_url
            .as_ref()
            .is_none_or(|s| s.trim().is_empty())
            || cfg.user_id.as_ref().is_none_or(|s| s.trim().is_empty())
        {
            return;
        }

        let payload = event.payload();
        let current_state: HashMap<String, bool> = match serde_json::from_str(payload) {
            Ok(state) => state,
            Err(_) => return,
        };

        let mut prev_state = was_running.lock().unwrap();

        for (game_id, is_running) in &current_state {
            let prev = prev_state.get(game_id).copied().unwrap_or(false);

            if prev && !is_running {
                let app_for_async = app_clone.clone();
                let gid = game_id.clone();
                let tray = tray_state.clone();

                tray.syncing_inc();
                tray.update_tooltip();

                tauri::async_runtime::spawn(async move {
                    let res = sync::upload::sync_upload_game_impl(
                        gid.clone(),
                        app_for_async.clone(),
                        None,
                    )
                    .await;

                    tray.syncing_dec();
                    tray.clone().refresh_unsynced_async();

                    match res {
                        Ok(r) => {
                            let _ = app_for_async.emit("auto-sync-done", {
                                #[derive(serde::Serialize, Clone)]
                                struct Payload {
                                    game_id: String,
                                    ok_count: u32,
                                    err_count: u32,
                                }
                                Payload {
                                    game_id: gid.clone(),
                                    ok_count: r.ok_count,
                                    err_count: r.err_count,
                                }
                            });
                            crate::notifications::writer::try_record_auto_sync_done(
                                &app_for_async,
                                &gid,
                                r.ok_count,
                                r.err_count,
                            );
                        }
                        Err(e) => {
                            let err_copy = e.clone();
                            let _ = app_for_async.emit("auto-sync-error", {
                                #[derive(serde::Serialize, Clone)]
                                struct Payload {
                                    game_id: String,
                                    error: String,
                                }
                                Payload {
                                    game_id: gid.clone(),
                                    error: e,
                                }
                            });
                            crate::notifications::writer::try_record_auto_sync_error(
                                &app_for_async,
                                &gid,
                                &err_copy,
                            );
                        }
                    }
                });
            }
        }

        *prev_state = current_state;
    });
}
