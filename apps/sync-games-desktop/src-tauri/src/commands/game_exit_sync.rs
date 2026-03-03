//! Detecta cuando un juego se cierra y dispara la subida automática de guardados.
//! Complementa el watcher de archivos: captura el guardado final al salir.

use crate::commands::sync;
use crate::config;
use crate::process_check;
use std::collections::HashMap;
use std::thread;
use std::time::Duration;
use tauri::Emitter;

/// Spawns a background thread that polls game processes.
/// When a game transitions from running → not running, triggers upload.
pub fn spawn_exit_watcher(app: tauri::AppHandle) {
    thread::spawn(move || {
        let poll_interval = Duration::from_secs(5);
        let mut was_running: HashMap<String, bool> = HashMap::new();

        loop {
            let cfg = config::load_config();
            if cfg
                .api_base_url
                .as_ref()
                .map_or(true, |s| s.trim().is_empty())
                || cfg.user_id.as_ref().map_or(true, |s| s.trim().is_empty())
            {
                thread::sleep(poll_interval);
                continue;
            }

            for game in &cfg.games {
                let game_id = game.id.clone();
                let paths = game.paths.clone();
                let is_running = process_check::is_game_running(&game_id, &paths);

                let prev = was_running.insert(game_id.clone(), is_running);

                // Transición: estaba corriendo, ahora no → sync
                if prev == Some(true) && !is_running {
                    let app = app.clone();
                    let gid = game_id.clone();
                    tauri::async_runtime::spawn(async move {
                        match sync::sync_upload_game(gid.clone()).await {
                            Ok(r) => {
                                let _ = app.emit("auto-sync-done", {
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
                            }
                            Err(e) => {
                                let _ = app.emit("auto-sync-error", {
                                    #[derive(serde::Serialize, Clone)]
                                    struct Payload {
                                        game_id: String,
                                        error: String,
                                    }
                                    Payload {
                                        game_id: gid,
                                        error: e,
                                    }
                                });
                            }
                        }
                    });
                }
            }

            thread::sleep(poll_interval);
        }
    });
}
