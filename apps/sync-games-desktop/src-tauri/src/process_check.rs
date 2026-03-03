//! Detección de juegos en ejecución para evitar sincronizar mientras hay archivos bloqueados.

use crate::config;
use std::path::Path;
use sysinfo::{ProcessesToUpdate, System};

/// Indica si algún proceso de un juego configurado está en ejecución.
/// Usa `executableNames` del config si está definido, o infiere desde la ruta.
pub fn is_game_running(game_id: &str, paths: &[String]) -> bool {
    let names = get_executable_names_to_check(game_id, paths);
    if names.is_empty() {
        return false;
    }

    let mut sys = System::new_all();
    sys.refresh_processes(ProcessesToUpdate::All);

    for process in sys.processes().values() {
        let proc_name = process.name().to_string_lossy().to_lowercase();
        for check in &names {
            let check_lower = check.to_lowercase();
            // Comparación exacta (ej. eldenring.exe) o el proc puede ser "EldenRing.exe"
            if proc_name == check_lower {
                return true;
            }
        }
    }
    false
}

/// Genera candidatos de nombres de ejecutable a buscar.
fn get_executable_names_to_check(game_id: &str, paths: &[String]) -> Vec<String> {
    // 1. Intentar desde la configuración del juego (si añadimos el campo)
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

    // 2. Inferir desde la última parte de la ruta
    for raw in paths {
        let expanded = expand_path(raw.trim());
        if let Some(p) = expanded {
            let path = Path::new(&p);
            if let Some(last) = path.components().last() {
                let name = last.as_os_str().to_string_lossy();
                if !name.is_empty() && name != "." && name != ".." {
                    let candidates = infer_exe_candidates(&name, game_id);
                    if !candidates.is_empty() {
                        return candidates;
                    }
                }
            }
        }
    }

    Vec::new()
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

fn infer_exe_candidates(folder_name: &str, game_id: &str) -> Vec<String> {
    let mut candidates = Vec::new();

    let base = folder_name.replace(['\'', '"'], "").replace(' ', "");

    if !base.is_empty() {
        #[cfg(target_os = "windows")]
        {
            candidates.push(ensure_exe_ext(&base));
            candidates.push(ensure_exe_ext(&base.to_lowercase()));
            candidates.push(format!("{}-Win64-Shipping.exe", base));
            candidates.push(format!("{}-Win64-Shipping.exe", base.to_lowercase()));
        }
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(base.clone());
            candidates.push(base.to_lowercase());
        }
    }

    let from_id = game_id
        .replace('-', " ")
        .split_whitespace()
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                None => String::new(),
                Some(f) => f.to_uppercase().chain(c).collect::<String>(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    if !from_id.is_empty() {
        let compact = from_id.replace(' ', "");
        #[cfg(target_os = "windows")]
        {
            candidates.push(ensure_exe_ext(&compact));
            candidates.push(ensure_exe_ext(&compact.to_lowercase()));
        }
        #[cfg(not(target_os = "windows"))]
        {
            candidates.push(compact.clone());
            candidates.push(compact.to_lowercase());
        }
    }

    candidates.sort();
    candidates.dedup();
    candidates
}

fn expand_path(raw: &str) -> Option<String> {
    let mut result = raw.to_string();
    let re = regex::Regex::new(r"%([^%]+)%").ok()?;
    for cap in re.captures_iter(raw) {
        let var = cap.get(1)?.as_str();
        let val = std::env::var(var).unwrap_or_default();
        result = result.replace(&format!("%{}%", var), &val);
    }
    if result.starts_with('~') {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        if !home.is_empty() {
            let rest = result.trim_start_matches('~').trim_start_matches('/');
            result = if rest.is_empty() {
                home
            } else {
                format!("{}/{}", home.trim_end_matches(&['/', '\\']), rest)
            };
        }
    }
    if result.is_empty() {
        None
    } else {
        Some(result)
    }
}
