//! Escaneo de rutas candidatas para guardados.
//! Réplica de la lógica del CLI (FileSystemPathScanner).
//! Mejorado con el manifiesto de Ludusavi para nombres y rutas precisas (Steam y otros).

mod extensions;
mod filters;
mod paths;

use crate::config;
#[cfg(target_os = "windows")]
use crate::manifest;
#[cfg(target_os = "windows")]
use crate::steam;
use filters::{folder_contains_save_like_files, is_excluded_folder};
use rayon::prelude::*;
use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PathCandidateDto {
    pub path: String,
    pub folder_name: String,
    pub base_path: String,
    /// Steam App ID cuando se conoce (p. ej. por manifiesto o por ruta Steam).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_app_id: Option<String>,
    /// Varias rutas de guardado para el mismo juego (manifiesto Ludusavi). Si está presente, al añadir se deben registrar todas.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
}

// ─── Expansión de rutas ──────────────────────────────────────────────────────

fn expand_path(raw: &str) -> Option<String> {
    let mut result = raw.to_string();
    // %VAR%
    let re = Regex::new(r"%([^%]+)%").ok()?;
    for cap in re.captures_iter(raw) {
        let var = cap.get(1)?.as_str();
        let val = std::env::var(var).unwrap_or_default();
        result = result.replace(&format!("%{}%", var), &val);
    }
    // ~
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

// ─── Unidades de almacenamiento (Windows) ─────────────────────────────────────

/// Devuelve todas las unidades lógicas (ej. `C:\`, `D:\`) que existen y son legibles.
#[cfg(target_os = "windows")]
fn logical_drives() -> Vec<String> {
    (b'A'..=b'Z')
        .map(|c| format!("{}:\\", c as char))
        .filter(|root| Path::new(root).exists() && fs::read_dir(root).is_ok())
        .collect()
}

// ─── Base paths y listado ────────────────────────────────────────────────────

fn list_subdirs(dir_path: &Path) -> Vec<(PathBuf, String)> {
    let Ok(entries) = fs::read_dir(dir_path) else {
        return vec![];
    };
    entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_dir() {
                return None;
            }
            let name = e.file_name().into_string().ok()?;
            if name.starts_with('.') {
                return None;
            }
            Some((e.path(), name))
        })
        .collect()
}

/// Escanea una ruta base y devuelve candidatos (sin dedup; se hace al fusionar).
fn scan_base_paths_into_vec(base_path: &str, base_label: &str) -> Vec<PathCandidateDto> {
    let base = Path::new(base_path);
    if !base.exists() || !base.is_dir() {
        return vec![];
    }
    let mut out = Vec::new();
    for (full_path, name) in list_subdirs(base) {
        if is_excluded_folder(&name) {
            continue;
        }
        if !folder_contains_save_like_files(&full_path) {
            continue;
        }
        let path_str = full_path.to_string_lossy().to_string();
        out.push(PathCandidateDto {
            path: path_str,
            folder_name: name,
            base_path: base_label.to_string(),
            steam_app_id: None,
            paths: None,
        });
    }
    out
}

#[allow(dead_code)]
fn scan_base_paths(
    base_path: &str,
    base_label: &str,
    candidates: &mut Vec<PathCandidateDto>,
    seen: &mut HashSet<String>,
) {
    for c in scan_base_paths_into_vec(base_path, base_label) {
        let key = c.path.to_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.insert(key);
        candidates.push(c);
    }
}

// ─── Steam ───────────────────────────────────────────────────────────────────

#[cfg(target_os = "windows")]
fn find_steam_userdata_candidates(
    steam_path: &str,
    manifest_index: &Option<manifest::ManifestIndex>,
) -> Vec<PathCandidateDto> {
    let userdata = Path::new(steam_path).join("userdata");
    if !userdata.exists() || !userdata.is_dir() {
        return vec![];
    }
    let mut out = Vec::new();
    let re = Regex::new(r"^\d+$").unwrap();
    for (user_dir, user_name) in list_subdirs(&userdata) {
        if !re.is_match(&user_name) {
            continue;
        }
        for (app_dir, app_name) in list_subdirs(&user_dir) {
            if !re.is_match(&app_name) {
                continue;
            }
            let remote = app_dir.join("remote");
            let path_to_check = if remote.exists() {
                remote
            } else {
                app_dir.clone()
            };
            if !folder_contains_save_like_files(&path_to_check) {
                continue;
            }
            if let Some(p) = path_to_check.to_str() {
                let (folder_name, steam_app_id, paths, path_display) =
                    if let Some(index) = manifest_index {
                        if let Some((entry, resolved)) =
                            manifest::get_entry_for_steam_app(index, &app_name, None)
                        {
                            let mut all_paths = vec![p.to_string()];
                            for r in &resolved {
                                if Path::new(r).exists() && !all_paths.contains(r) {
                                    all_paths.push(r.clone());
                                }
                            }
                            let paths = if all_paths.len() > 1 {
                                Some(all_paths.clone())
                            } else {
                                None
                            };
                            let path_display =
                                all_paths.first().cloned().unwrap_or_else(|| p.to_string());
                            (entry.name, Some(app_name.clone()), paths, path_display)
                        } else {
                            (
                                format!("Steam App {}", app_name),
                                Some(app_name.clone()),
                                None,
                                p.to_string(),
                            )
                        }
                    } else {
                        (
                            format!("Steam App {}", app_name),
                            Some(app_name.clone()),
                            None,
                            p.to_string(),
                        )
                    };
                out.push(PathCandidateDto {
                    path: path_display,
                    folder_name,
                    base_path: format!("Steam userdata ({})", user_name),
                    steam_app_id,
                    paths,
                });
            }
        }
    }
    out
}

#[cfg(target_os = "windows")]
fn find_steam_library_paths(steam_path: &str) -> Vec<String> {
    let vdf = Path::new(steam_path)
        .join("steamapps")
        .join("libraryfolders.vdf");
    let Ok(content) = fs::read_to_string(&vdf) else {
        return vec![];
    };
    let re = Regex::new(r#""path"\s+"([^"]+)""#).unwrap();
    let steam_norm = std::path::Path::new(steam_path)
        .canonicalize()
        .ok()
        .and_then(|p| p.to_str().map(|s| s.to_lowercase()));
    let mut paths = Vec::new();
    for cap in re.captures_iter(&content) {
        if let Some(m) = cap.get(1) {
            let p = m.as_str().replace("\\\\", "\\");
            // Excluir la carpeta principal de Steam
            if let (Some(ref steam), Ok(lib_canon)) = (&steam_norm, Path::new(&p).canonicalize()) {
                if let Some(lib_s) = lib_canon.to_str() {
                    if lib_s.to_lowercase() == *steam {
                        continue;
                    }
                }
            }
            paths.push(p);
        }
    }
    paths
}

#[cfg(target_os = "windows")]
fn find_steam_library_candidates(library_path: &str) -> Vec<PathCandidateDto> {
    let common = Path::new(library_path).join("steamapps").join("common");
    if !common.exists() || !common.is_dir() {
        return vec![];
    }
    let mut out = Vec::new();
    for (full_path, name) in list_subdirs(&common) {
        if !folder_contains_save_like_files(&full_path) {
            continue;
        }
        if let Some(p) = full_path.to_str() {
            out.push(PathCandidateDto {
                path: p.to_string(),
                folder_name: name,
                base_path: format!("Steam Library ({})", library_path),
                steam_app_id: None,
                paths: None,
            });
        }
    }
    out
}

#[cfg(target_os = "windows")]
fn scan_steam(
    candidates: &mut Vec<PathCandidateDto>,
    seen: &mut HashSet<String>,
    path_to_appid: &std::collections::HashMap<PathBuf, String>,
    manifest_index: &Option<manifest::ManifestIndex>,
) {
    let steam_path = paths::DEFAULT_STEAM_PATH_WIN32;
    if !Path::new(steam_path).exists() {
        return;
    }
    for c in find_steam_userdata_candidates(steam_path, manifest_index) {
        let key = c.path.to_lowercase();
        if !seen.contains(&key) {
            seen.insert(key);
            candidates.push(c);
        }
    }
    for mut c in find_steam_library_candidates(steam_path) {
        let app_id = steam::resolve_steam_app_id_from_map(path_to_appid, &c.path);
        if let (Some(ref index), Some(app_id)) = (manifest_index, app_id) {
            if let Some((entry, resolved)) =
                manifest::get_entry_for_steam_app(index, &app_id, Some(&c.path))
            {
                let mut all_paths = vec![c.path.clone()];
                for r in &resolved {
                    if Path::new(r).exists() && !all_paths.contains(r) {
                        all_paths.push(r.clone());
                    }
                }
                c.folder_name = entry.name;
                c.steam_app_id = Some(app_id);
                if all_paths.len() > 1 {
                    c.paths = Some(all_paths.clone());
                    c.path = all_paths[0].clone();
                }
            } else {
                c.steam_app_id = Some(app_id);
            }
        }
        let key = c.path.to_lowercase();
        if !seen.contains(&key) {
            seen.insert(key);
            candidates.push(c);
        }
    }
    for lib in find_steam_library_paths(steam_path) {
        for mut c in find_steam_library_candidates(&lib) {
            let app_id = steam::resolve_steam_app_id_from_map(path_to_appid, &c.path);
            if let (Some(ref index), Some(app_id)) = (manifest_index, app_id) {
                if let Some((entry, resolved)) =
                    manifest::get_entry_for_steam_app(index, &app_id, Some(&c.path))
                {
                    let mut all_paths = vec![c.path.clone()];
                    for r in &resolved {
                        if Path::new(r).exists() && !all_paths.contains(r) {
                            all_paths.push(r.clone());
                        }
                    }
                    c.folder_name = entry.name;
                    c.steam_app_id = Some(app_id);
                    if all_paths.len() > 1 {
                        c.paths = Some(all_paths.clone());
                        c.path = all_paths[0].clone();
                    }
                } else {
                    c.steam_app_id = Some(app_id);
                }
            }
            let key = c.path.to_lowercase();
            if !seen.contains(&key) {
                seen.insert(key);
                candidates.push(c);
            }
        }
    }
}

// ─── Cracks ──────────────────────────────────────────────────────────────────

/// Steam App ID: solo dígitos, típicamente 4–10 caracteres.
#[cfg(target_os = "windows")]
fn is_steam_app_id_folder(name: &str) -> bool {
    name.len() >= 4 && name.len() <= 10 && name.chars().all(|c| c.is_ascii_digit())
}

#[cfg(target_os = "windows")]
fn contains_saves_at_any_depth(dir_path: &Path, depth: usize) -> bool {
    if depth > 5 || !dir_path.exists() || !dir_path.is_dir() {
        return false;
    }
    if folder_contains_save_like_files(dir_path) {
        return true;
    }
    for (sub_path, name) in list_subdirs(dir_path) {
        if name == "steam_settings" || name == "settings" {
            continue;
        }
        if contains_saves_at_any_depth(&sub_path, depth + 1) {
            return true;
        }
    }
    false
}

#[cfg(target_os = "windows")]
fn scan_cracks(
    candidates: &mut Vec<PathCandidateDto>,
    seen: &mut HashSet<String>,
    manifest_index: &Option<manifest::ManifestIndex>,
) {
    for (path_tpl, label) in paths::CRACK_SAVE_LOCATIONS {
        let Some(base_path) = expand_path(path_tpl) else {
            continue;
        };
        let base = Path::new(&base_path);
        if !base.exists() || !base.is_dir() {
            continue;
        }
        let base_path_display = base_path.clone();

        for (sub_path, sub_name) in list_subdirs(base) {
            if sub_name == "steam_settings" || sub_name == "settings" {
                continue;
            }

            if is_steam_app_id_folder(&sub_name) {
                // Nivel directo: base/2050650 (ej. EMPRESS, Goldberg)
                if !contains_saves_at_any_depth(&sub_path, 0) {
                    continue;
                }
                if let Some(p) = sub_path.to_str() {
                    let key = p.to_lowercase();
                    if seen.contains(&key) {
                        continue;
                    }
                    seen.insert(key.to_string());
                    let (folder_name, steam_app_id) = if let Some(ref index) = manifest_index {
                        if let Some((entry, _)) =
                            manifest::get_entry_for_steam_app(index, &sub_name, Some(p))
                        {
                            (entry.name, Some(sub_name.to_string()))
                        } else {
                            (
                                format!("Steam App {}", sub_name),
                                Some(sub_name.to_string()),
                            )
                        }
                    } else {
                        (
                            format!("Steam App {}", sub_name),
                            Some(sub_name.to_string()),
                        )
                    };
                    candidates.push(PathCandidateDto {
                        path: p.to_string(),
                        folder_name,
                        base_path: format!("{} ({})", label, base_path_display),
                        steam_app_id,
                        paths: None,
                    });
                }
            } else {
                // Un nivel más: base/CODEX/2050650 (ej. Steam → CODEX → app_id)
                for (app_dir, app_name) in list_subdirs(&sub_path) {
                    if app_name == "steam_settings" || app_name == "settings" {
                        continue;
                    }
                    if !is_steam_app_id_folder(&app_name) {
                        continue;
                    }
                    if !contains_saves_at_any_depth(&app_dir, 0) {
                        continue;
                    }
                    if let Some(p) = app_dir.to_str() {
                        let key = p.to_lowercase();
                        if seen.contains(&key) {
                            continue;
                        }
                        seen.insert(key.to_string());
                        let (folder_name, steam_app_id) = if let Some(ref index) = manifest_index {
                            if let Some((entry, _)) =
                                manifest::get_entry_for_steam_app(index, &app_name, Some(p))
                            {
                                (entry.name, Some(app_name.to_string()))
                            } else {
                                (
                                    format!("Steam App {}", app_name),
                                    Some(app_name.to_string()),
                                )
                            }
                        } else {
                            (
                                format!("Steam App {}", app_name),
                                Some(app_name.to_string()),
                            )
                        };
                        candidates.push(PathCandidateDto {
                            path: p.to_string(),
                            folder_name,
                            base_path: format!("{} ({})", label, base_path_display),
                            steam_app_id,
                            paths: None,
                        });
                    }
                }
            }
        }
    }
}

// ─── Comando principal ────────────────────────────────────────────────────────

/// Trabajo de escaneo base para paralelizar: (ruta, etiqueta).
fn base_scan_jobs(cfg: &config::Config) -> Vec<(String, String)> {
    let mut jobs = Vec::new();

    for (tpl, label) in paths::BASE_SCAN_TEMPLATES {
        if let Some(expanded) = expand_path(tpl) {
            jobs.push((expanded, label.to_string()));
        }
    }

    #[cfg(target_os = "windows")]
    {
        for root in logical_drives() {
            let label = format!("Disco {}", root.trim_end_matches(&['\\', ':']));
            jobs.push((root, label));
        }
    }

    for extra in &cfg.custom_scan_paths {
        let trimmed = extra.trim();
        if trimmed.is_empty() {
            continue;
        }
        let path = if let Some(expanded) = expand_path(trimmed) {
            expanded
        } else {
            trimmed.to_string()
        };
        if !Path::new(&path).exists() {
            continue;
        }
        #[cfg(target_os = "windows")]
        {
            let system_root = std::env::var("SystemDrive")
                .map(|d| format!("{}\\", d))
                .unwrap_or_else(|_| "C:\\".to_string())
                .to_lowercase();
            if path.to_lowercase() == system_root {
                continue;
            }
        }
        jobs.push((path, "Personalizada".to_string()));
    }

    jobs
}

/// Lógica de escaneo (síncrona). Rutas base en paralelo con Rayon; Steam/cracks secuenciales.
fn scan_path_candidates_sync() -> Vec<PathCandidateDto> {
    let cfg = config::load_config();
    let mut seen = HashSet::new();

    // Rutas base + discos + personalizadas: escaneo en paralelo
    let jobs = base_scan_jobs(&cfg);
    let mut candidates: Vec<PathCandidateDto> = jobs
        .par_iter()
        .flat_map(|(base_path, label)| scan_base_paths_into_vec(base_path, label))
        .collect();

    // Dedup por path (primera ocurrencia gana)
    candidates.retain(|c| {
        let key = c.path.to_lowercase();
        if seen.contains(&key) {
            false
        } else {
            seen.insert(key);
            true
        }
    });

    // Steam y cracks (solo Windows); requieren manifiesto y son más complejos
    #[cfg(target_os = "windows")]
    {
        let path_to_appid = steam::get_steam_path_to_appid_map();
        let manifest_index = manifest::load_manifest_index();
        scan_steam(&mut candidates, &mut seen, &path_to_appid, &manifest_index);
        scan_cracks(&mut candidates, &mut seen, &manifest_index);
    }

    candidates.sort_by(|a, b| {
        a.base_path
            .cmp(&b.base_path)
            .then(a.folder_name.cmp(&b.folder_name))
    });
    candidates
}

#[tauri::command]
pub async fn scan_path_candidates() -> Result<Vec<PathCandidateDto>, String> {
    tauri::async_runtime::spawn_blocking(scan_path_candidates_sync)
        .await
        .map_err(|e| e.to_string())
}
