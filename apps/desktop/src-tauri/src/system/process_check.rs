//! Detección de procesos de juego y monitoreo de actividad en tiempo real.

use crate::config;
use crate::game_mode::sync_detected_game_cpu_boost;
use crate::game_mode::DetectedGameProcess;
use crate::time;
use std::collections::{HashMap, HashSet};
#[cfg(windows)]
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Instant;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

static GLOBAL_SYS: OnceLock<Mutex<System>> = OnceLock::new();

pub(crate) fn get_sys() -> std::sync::MutexGuard<'static, System> {
    GLOBAL_SYS
        .get_or_init(|| Mutex::new(System::new()))
        .lock()
        .expect("Mutex de sysinfo envenenado")
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningProcessPickRow {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_png_base64: Option<String>,
}

/// Lista procesos únicos por nombre para el selector manual: misma clase de iconos asociados
/// al `.exe`/binario que muestra Windows (Administrador de tareas) cuando `get_file_icon` aplica.
pub fn list_running_processes_for_pick() -> Vec<RunningProcessPickRow> {
    let mut sys = get_sys();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet),
    );

    let mut exe_by_name: HashMap<String, PathBuf> = HashMap::new();
    for proc in sys.processes().values() {
        let name = proc.name().to_string_lossy().into_owned();
        if exe_by_name.contains_key(&name) {
            continue;
        }
        let Some(exe_path) = proc.exe() else {
            continue;
        };
        if exe_path.as_os_str().is_empty() {
            continue;
        }
        exe_by_name.insert(name, exe_path.to_path_buf());
    }

    let mut names: Vec<String> = exe_by_name.keys().cloned().collect();
    names.sort_unstable();

    names
        .into_iter()
        .map(|name| {
            let path = exe_by_name.get(&name);
            RunningProcessPickRow {
                name,
                icon_png_base64: path.and_then(|p| {
                    #[cfg(windows)]
                    {
                        exe_icon_png_b64(p.as_path())
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = p;
                        None::<String>
                    }
                }),
            }
        })
        .collect()
}

#[cfg(windows)]
fn exe_icon_png_b64(path: &Path) -> Option<String> {
    if !path.exists() {
        return None;
    }
    encode_icon_rgba_png_b64(file_icon_provider::get_file_icon(path, 32).ok()?)
}

#[cfg(windows)]
fn encode_icon_rgba_png_b64(icon: file_icon_provider::Icon) -> Option<String> {
    encode_rgba_png_base64(icon.width, icon.height, &icon.pixels)
}

#[cfg(windows)]
fn encode_rgba_png_base64(width: u32, height: u32, rgba: &[u8]) -> Option<String> {
    use base64::Engine;
    use png::{BitDepth, ColorType, Encoder};
    use std::io::Cursor;

    let pixels = usize::checked_mul(width as usize, height as usize)?.checked_mul(4)?;
    if rgba.len() != pixels {
        return None;
    }
    let mut buf = Cursor::new(Vec::new());
    {
        let mut encoder = Encoder::new(&mut buf, width, height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(base64::engine::general_purpose::STANDARD.encode(buf.into_inner()))
}

/// Determina si un juego específico está en ejecución basándose en sus ejecutables conocidos.
///
/// # Arguments
/// * `game_id` - Identificador único del juego.
/// * `_paths` - Rutas de guardado (actualmente no utilizadas para la detección de proceso).
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

/// Evalúa el estado de ejecución de múltiples juegos de forma simultánea.
///
/// Optimiza el rendimiento realizando una única actualización del árbol de procesos
/// y pre-calculando los candidatos de nombres de ejecutables.
///
/// # Returns
/// Un `HashMap` donde la clave es el `game_id` y el valor es un booleano de ejecución.
pub fn are_games_running(game_ids: &[String]) -> HashMap<String, bool> {
    scan_games_running(game_ids).0
}

pub fn scan_games_running(
    game_ids: &[String],
) -> (HashMap<String, bool>, Vec<DetectedGameProcess>) {
    let cfg = config::load_config();
    scan_games_running_with_config(&cfg, game_ids)
}

pub fn scan_games_running_with_config(
    cfg: &config::Config,
    game_ids: &[String],
) -> (HashMap<String, bool>, Vec<DetectedGameProcess>) {
    let mut result: HashMap<String, bool> = HashMap::with_capacity(game_ids.len());
    let mut processes_out: Vec<DetectedGameProcess> = Vec::new();

    if game_ids.is_empty() {
        return (result, processes_out);
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
        ProcessRefreshKind::new()
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_memory(),
    );

    #[derive(Clone)]
    struct CpuBoostCand {
        pid: u32,
        exe_lc: String,
        rss: u64,
    }

    const CPU_BOOST_TOP_PIDS_PER_GAME: usize = 3;

    let mut pools: HashMap<String, Vec<CpuBoostCand>> = HashMap::new();
    let mut matched_root_pids: HashMap<String, HashSet<u32>> = HashMap::new();

    for (pid, process) in sys.processes() {
        let exe_lc = process.name().to_string_lossy().to_lowercase();
        for game_id in game_ids {
            let Some(names) = names_by_game.get(game_id) else {
                continue;
            };
            if !names.contains(&exe_lc) {
                continue;
            }
            *result.entry(game_id.clone()).or_insert(false) = true;
            pools
                .entry(game_id.clone())
                .or_default()
                .push(CpuBoostCand {
                    pid: pid.as_u32(),
                    exe_lc: exe_lc.clone(),
                    rss: process.memory(),
                });
            matched_root_pids
                .entry(game_id.clone())
                .or_default()
                .insert(pid.as_u32());
        }
    }

    // Subprocesos directos del árbol: padre coincide con exe del juego (un solo nivel).
    for (pid, process) in sys.processes() {
        let exe_lc = process.name().to_string_lossy().to_lowercase();
        let rss = process.memory();
        let Some(ppid_u32) = process.parent().map(Pid::as_u32) else {
            continue;
        };
        for game_id in game_ids {
            let Some(roots) = matched_root_pids.get(game_id) else {
                continue;
            };
            if !roots.contains(&ppid_u32) {
                continue;
            }
            pools
                .entry(game_id.clone())
                .or_default()
                .push(CpuBoostCand {
                    pid: pid.as_u32(),
                    exe_lc: exe_lc.clone(),
                    rss,
                });
        }
    }

    for game_id in game_ids {
        let Some(mut cands) = pools.remove(game_id) else {
            continue;
        };
        let mut by_pid: HashMap<u32, CpuBoostCand> = HashMap::new();
        for c in cands.drain(..) {
            match by_pid.entry(c.pid) {
                std::collections::hash_map::Entry::Occupied(mut o) => {
                    if c.rss > o.get().rss {
                        o.insert(c);
                    }
                }
                std::collections::hash_map::Entry::Vacant(v) => {
                    v.insert(c);
                }
            }
        }
        let mut v: Vec<CpuBoostCand> = by_pid.into_values().collect();
        v.sort_by_key(|c| std::cmp::Reverse(c.rss));
        processes_out.extend(v.into_iter().take(CPU_BOOST_TOP_PIDS_PER_GAME).map(|c| {
            DetectedGameProcess {
                game_id: game_id.clone(),
                pid: c.pid,
                exe_name_lc: c.exe_lc,
            }
        }));
    }

    (result, processes_out)
}

/// Comando Tauri original — sin cambios en su firma pública.
///
/// Se conserva para que el `invoke_handler` del builder no necesite
/// modificarse. Internamente delega en `run_watcher_loop_with_token`
/// sin token (nunca cancela por shutdown, pero tampoco bloquea el cierre
/// porque el runtime de Tokio lo mata igualmente al salir).
///
/// En setups donde se usa el ShutdownCoordinator, NO llamar a este comando
/// desde setup.rs — llamar a `run_watcher_loop_with_token` directamente.
#[allow(dead_code)]
#[tauri::command]
pub fn start_process_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        run_watcher_loop_with_token(&app, CancellationToken::new()).await;
    });
}

/// Bucle del process watcher con punto de salida limpia via CancellationToken.
///
/// Llamar desde `setup.rs` pasando el token del ShutdownBus:
///
/// ```rust
/// let token = shutdown_bus.token();
/// tauri::async_runtime::spawn(async move {
///     process_check::run_watcher_loop_with_token(&app_handle, token).await;
///     guard.complete();
/// });
/// ```
///
/// El select! interno garantiza que cuando el token es cancelado, el loop
/// sale inmediatamente aunque esté en medio del sleep de 10 segundos.
pub async fn run_watcher_loop_with_token(app: &AppHandle, token: CancellationToken) {
    let mut previous_state: HashMap<String, bool> = HashMap::new();
    let mut last_checkpoint: HashMap<String, Instant> = HashMap::new();

    loop {
        // Punto de salida al inicio de cada ciclo (sin coste si no está cancelado).
        if token.is_cancelled() {
            log::info!("[process_watcher] Token cancelado, terminando bucle.");
            break;
        }

        let cfg = config::load_config();
        let game_ids: Vec<String> = cfg.games.iter().map(|g| g.id.clone()).collect();
        let (current, pid_candidates) = scan_games_running_with_config(&cfg, &game_ids);

        sync_detected_game_cpu_boost(
            cfg.game_mode_boost_detected_game_cpu,
            current.values().any(|&r| r),
            &pid_candidates,
        );

        if current != previous_state {
            let _ = app.emit("games-running-status", &current);
        }

        for (game_id, &is_running) in &current {
            let was_running = *previous_state.get(game_id).unwrap_or(&false);

            if is_running {
                if !was_running {
                    last_checkpoint.insert(game_id.clone(), Instant::now());
                } else if let Some(start) = last_checkpoint.get(game_id) {
                    let elapsed = start.elapsed().as_secs();
                    if elapsed >= 60 {
                        let _ = time::add_playtime(game_id, elapsed);
                        last_checkpoint.insert(game_id.clone(), Instant::now());
                        emit_playtime_update(app, game_id);
                    }
                }
            } else if was_running {
                if let Some(start) = last_checkpoint.remove(game_id) {
                    let remaining = start.elapsed().as_secs();
                    if remaining > 0 {
                        let _ = time::add_playtime(game_id, remaining);
                        emit_playtime_update(app, game_id);
                    }
                }
            }
        }

        previous_state = current;

        // Sleep interruptible: si el token se cancela durante la espera,
        // el select! sale de inmediato sin bloquear el shutdown 10 segundos.
        tokio::select! {
            _ = token.cancelled() => {
                log::info!("[process_watcher] Token cancelado durante sleep, terminando.");
                break;
            }
            _ = tokio::time::sleep(std::time::Duration::from_secs(10)) => {}
        }
    }
}

fn emit_playtime_update(app: &AppHandle, game_id: &str) {
    let new_time = time::get_game_playtime(game_id);
    let total_time = time::get_total_playtime();
    let _ = app.emit(
        "playtime-updated",
        Payload {
            game_id: game_id.to_string(),
            new_time,
        },
    );
    let _ = app.emit("total-playtime-updated", total_time);
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    game_id: String,
    new_time: u64,
}

/// Obtiene la lista de nombres de ejecutables a monitorear para un ID de juego.
///
/// # Arguments
/// * `game_id` - Identificador único del juego.
/// # Returns
/// Una lista de nombres de ejecutables a monitorear para el juego.
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

/// Añade la extensión de ejecutable `.exe` si es necesario.
///
/// # Arguments
/// * `s` - Nombre de ejecutable.
/// # Returns
/// El nombre de ejecutable con la extensión `.exe` si es necesario.
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

/// Infiere posibles nombres de ejecutables basándose en el texto del juego.
///
/// # Arguments
/// * `text` - Texto del juego.
/// # Returns
/// Una lista de posibles nombres de ejecutables.
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
        candidates.push(base.clone());
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
