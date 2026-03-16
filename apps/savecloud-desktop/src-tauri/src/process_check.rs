//! Detección de juegos en ejecución para evitar sincronizar mientras hay archivos bloqueados.
//! Incluye un watcher para emitir eventos al frontend de forma reactiva.

use crate::config;
use std::collections::HashMap;
use std::sync::Mutex;
use std::sync::OnceLock;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter};

static GLOBAL_SYS: OnceLock<Mutex<System>> = OnceLock::new();

pub(crate) fn get_sys() -> std::sync::MutexGuard<'static, System> {
    GLOBAL_SYS
        .get_or_init(|| Mutex::new(System::new()))
        .lock()
        .expect("Mutex de sysinfo envenenado")
}

/// Indica si algún proceso de un juego configurado está en ejecución.
pub fn is_game_running(game_id: &str, _paths: &[String]) -> bool {
    let names = get_executable_names_to_check(game_id);
    if names.is_empty() {
        return false;
    }

    let mut sys = get_sys();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet),
    );

    for process in sys.processes().values() {
        let proc_name = process.name().to_string_lossy().to_lowercase();

        for check in &names {
            if proc_name == check.to_lowercase() {
                return true;
            }
        }
    }
    false
}

/// Versión optimizada para varios juegos a la vez.
pub fn are_games_running(game_ids: &[String]) -> HashMap<String, bool> {
    let cfg = config::load_config();
    let mut result: HashMap<String, bool> = HashMap::with_capacity(game_ids.len());

    if game_ids.is_empty() {
        return result;
    }

    let mut names_by_game: HashMap<String, Vec<String>> = HashMap::with_capacity(game_ids.len());

    for id in game_ids {
        result.insert(id.clone(), false);

        if let Some(game) = cfg.games.iter().find(|g| g.id.eq_ignore_ascii_case(id)) {
            let mut names: Vec<String> = Vec::new();

            if let Some(ref execs) = game.executable_names {
                if !execs.is_empty() {
                    names = execs
                        .iter()
                        .filter_map(|s| {
                            let t = s.trim();
                            if t.is_empty() {
                                None
                            } else {
                                Some(ensure_exe_ext(t))
                            }
                        })
                        .collect();
                }
            }

            if names.is_empty() {
                names = infer_exe_candidates(id);
            }

            if !names.is_empty() {
                let names_lower: Vec<String> =
                    names.into_iter().map(|n| n.to_lowercase()).collect();
                names_by_game.insert(game.id.clone(), names_lower);
            }
        }
    }

    let mut sys = get_sys();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet),
    );

    for process in sys.processes().values() {
        let proc_name = process.name().to_string_lossy().to_lowercase();

        for game_id in game_ids {
            if result[game_id] {
                continue;
            }

            if let Some(check_names) = names_by_game.get(game_id) {
                if check_names.contains(&proc_name) {
                    result.insert(game_id.clone(), true);
                }
            }
        }
    }

    result
}

/// Inicia un hilo en segundo plano que revisa los procesos cada 5 segundos
/// y emite un evento al frontend SOLO si el estado de algún juego cambia.
#[tauri::command]
pub fn start_process_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut previous_state: HashMap<String, bool> = HashMap::new();

        loop {
            let cfg = config::load_config();
            let game_ids: Vec<String> = cfg.games.iter().map(|g| g.id.clone()).collect();

            if !game_ids.is_empty() {
                let current_state = are_games_running(&game_ids);

                if current_state != previous_state {
                    let _ = app.emit("games-running-status", &current_state);
                    previous_state = current_state;
                }
            }

            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
}

fn get_executable_names_to_check(game_id: &str) -> Vec<String> {
    let cfg = config::load_config();
    if let Some(game) = cfg
        .games
        .iter()
        .find(|g| g.id.eq_ignore_ascii_case(game_id))
    {
        if let Some(ref names) = game.executable_names {
            if !names.is_empty() {
                return names
                    .iter()
                    .filter_map(|s| {
                        let t = s.trim().to_string();
                        if t.is_empty() {
                            None
                        } else {
                            Some(ensure_exe_ext(&t))
                        }
                    })
                    .collect();
            }
        }
    }

    infer_exe_candidates(game_id)
}

fn ensure_exe_ext(s: &str) -> String {
    let s = s.trim();
    #[cfg(target_os = "windows")]
    {
        if s.to_lowercase().ends_with(".exe") {
            s.to_string()
        } else {
            format!("{}.exe", s)
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        s.to_string()
    }
}

/// Genera el ejecutable compactando el texto y creando un ACRÓNIMO a partir del ID
fn infer_exe_candidates(text: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let text = text.trim();
    if text.is_empty() {
        return candidates;
    }

    let base = text.replace(['\'', '"', ':', '-'], "").replace(' ', "");
    if !base.is_empty() {
        #[cfg(target_os = "windows")]
        {
            candidates.push(ensure_exe_ext(&base));
            candidates.push(format!("{}-Win64-Shipping.exe", base));
        }
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(base.clone());
        }
    }

    let mut acronym = String::new();
    let words = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty());

    for word in words {
        if word.chars().all(|c| c.is_ascii_digit()) {
            acronym.push_str(word);
        } else if let Some(c) = word.chars().next() {
            acronym.push(c.to_ascii_lowercase());
        }
    }

    if acronym.len() >= 2 && acronym.len() <= 6 {
        #[cfg(target_os = "windows")]
        candidates.push(ensure_exe_ext(&acronym));
        #[cfg(not(target_os = "windows"))]
        candidates.push(acronym.clone());
    }

    candidates.sort();
    candidates.dedup();
    candidates
}
