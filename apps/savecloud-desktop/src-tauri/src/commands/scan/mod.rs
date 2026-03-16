//! Escaneo de rutas candidatas para guardados.
//! Réplica de la lógica del CLI (FileSystemPathScanner).
//! Mejorado con el manifiesto de Ludusavi para nombres y rutas precisas (Steam y otros).

mod extensions;
mod filters;
mod paths;

use crate::config;
#[cfg(target_os = "windows")]
use crate::{manifest, steam};
use filters::{folder_contains_save_like_files, is_excluded_folder};
use rayon::prelude::*;
use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

static ENV_VAR_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"%([^%]+)%").unwrap());

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PathCandidateDto {
    pub path: String,
    pub folder_name: String,
    pub base_path: String,
    /// Steam App ID cuando se conoce (p. ej. por manifiesto o por ruta Steam).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_app_id: Option<String>,
    /// Varias rutas de guardado para el mismo juego (manifiesto Ludusavi).
    /// Si está presente, al añadir se deben registrar todas.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<String>>,
}

struct CandidateList {
    candidates: Vec<PathCandidateDto>,
    seen: HashSet<String>,
}

impl CandidateList {
    fn new() -> Self {
        Self {
            candidates: Vec::new(),
            seen: HashSet::new(),
        }
    }

    /// Añade un candidato si su ruta (en minúsculas) no ha sido vista antes.
    fn add(&mut self, candidate: PathCandidateDto) {
        let key = candidate.path.to_lowercase();
        if self.seen.insert(key) {
            self.candidates.push(candidate);
        }
    }

    fn extend(&mut self, items: impl IntoIterator<Item = PathCandidateDto>) {
        for item in items {
            self.add(item);
        }
    }

    fn into_inner(self) -> (Vec<PathCandidateDto>, HashSet<String>) {
        (self.candidates, self.seen)
    }
}

fn expand_path(raw: &str) -> Option<String> {
    let mut result = raw.to_string();

    // %VAR%
    for cap in ENV_VAR_REGEX.captures_iter(raw) {
        if let Some(var) = cap.get(1) {
            let var_str = var.as_str();
            let val = std::env::var(var_str).unwrap_or_default();
            result = result.replace(&format!("%{}%", var_str), &val);
        }
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

fn scan_base_paths_into_vec(base_path: &str, base_label: &str) -> Vec<PathCandidateDto> {
    let base = Path::new(base_path);
    if !base.exists() || !base.is_dir() {
        return vec![];
    }

    list_subdirs(base)
        .into_iter()
        .filter(|(full_path, name)| {
            !is_excluded_folder(name) && folder_contains_save_like_files(full_path)
        })
        .map(|(full_path, name)| PathCandidateDto {
            path: full_path.to_string_lossy().to_string(),
            folder_name: name,
            base_path: base_label.to_string(),
            steam_app_id: None,
            paths: None,
        })
        .collect()
}

#[cfg(target_os = "windows")]
mod windows_scanners {
    use super::*;

    static NUMBER_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+$").unwrap());
    static VDF_PATH_REGEX: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#""path"\s+"([^"]+)""#).unwrap());

    const MAX_SCAN_DEPTH: usize = 5;

    pub fn logical_drives() -> Vec<String> {
        (b'A'..=b'Z')
            .map(|c| format!("{}:\\", c as char))
            .filter(|root| Path::new(root).exists() && fs::read_dir(root).is_ok())
            .collect()
    }

    /// Centraliza la lógica repetitiva de consultar el manifiesto y armar las rutas.
    fn extract_manifest_data(
        app_id_or_name: &str,
        base_path: &str,
        manifest_index: &Option<manifest::ManifestIndex>,
    ) -> (String, Option<String>, Option<Vec<String>>, String) {
        if let Some(index) = manifest_index {
            if let Some((entry, resolved)) =
                manifest::get_entry_for_steam_app(index, app_id_or_name, Some(base_path))
            {
                let mut all_paths = vec![base_path.to_string()];
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
                let path_display = all_paths
                    .first()
                    .cloned()
                    .unwrap_or_else(|| base_path.to_string());

                return (
                    entry.name,
                    Some(app_id_or_name.to_string()),
                    paths,
                    path_display,
                );
            }
        }

        // Fallback si no hay manifiesto o no se encontró la entrada
        (
            format!("Steam App {}", app_id_or_name),
            Some(app_id_or_name.to_string()),
            None,
            base_path.to_string(),
        )
    }

    fn find_steam_userdata_candidates(
        steam_path: &str,
        manifest_index: &Option<manifest::ManifestIndex>,
    ) -> Vec<PathCandidateDto> {
        let userdata = Path::new(steam_path).join("userdata");
        if !userdata.exists() || !userdata.is_dir() {
            return vec![];
        }

        let mut out = Vec::new();
        for (user_dir, user_name) in list_subdirs(&userdata)
            .into_iter()
            .filter(|(_, n)| NUMBER_REGEX.is_match(n))
        {
            for (app_dir, app_name) in list_subdirs(&user_dir)
                .into_iter()
                .filter(|(_, n)| NUMBER_REGEX.is_match(n))
            {
                let remote = app_dir.join("remote");
                let path_to_check = if remote.exists() { remote } else { app_dir };

                if !folder_contains_save_like_files(&path_to_check) {
                    continue;
                }

                if let Some(p) = path_to_check.to_str() {
                    let (folder_name, steam_app_id, paths, path_display) =
                        extract_manifest_data(&app_name, p, manifest_index);

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

    fn find_steam_library_paths(steam_path: &str) -> Vec<String> {
        let vdf = Path::new(steam_path)
            .join("steamapps")
            .join("libraryfolders.vdf");
        let Ok(content) = fs::read_to_string(&vdf) else {
            return vec![];
        };

        let steam_norm = Path::new(steam_path)
            .canonicalize()
            .ok()
            .and_then(|p| p.to_str().map(|s| s.to_lowercase()));

        VDF_PATH_REGEX
            .captures_iter(&content)
            .filter_map(|cap| cap.get(1))
            .map(|m| m.as_str().replace("\\\\", "\\"))
            .filter(|p| {
                if let (Some(steam), Ok(lib_canon)) = (&steam_norm, Path::new(p).canonicalize()) {
                    if let Some(lib_s) = lib_canon.to_str() {
                        return lib_s.to_lowercase() != *steam;
                    }
                }
                true
            })
            .collect()
    }

    fn find_steam_library_candidates(library_path: &str) -> Vec<PathCandidateDto> {
        let common = Path::new(library_path).join("steamapps").join("common");
        if !common.exists() || !common.is_dir() {
            return vec![];
        }

        list_subdirs(&common)
            .into_iter()
            .filter(|(full_path, _)| folder_contains_save_like_files(full_path))
            .filter_map(|(full_path, name)| {
                full_path.to_str().map(|p| PathCandidateDto {
                    path: p.to_string(),
                    folder_name: name,
                    base_path: format!("Steam Library ({})", library_path),
                    steam_app_id: None,
                    paths: None,
                })
            })
            .collect()
    }

    pub fn scan_steam(
        candidate_list: &mut CandidateList,
        path_to_appid: &std::collections::HashMap<PathBuf, String>,
        manifest_index: &Option<manifest::ManifestIndex>,
    ) {
        let steam_path = paths::default_steam_path();
        if !Path::new(steam_path).exists() {
            return;
        }

        candidate_list.extend(find_steam_userdata_candidates(steam_path, manifest_index));

        let mut libraries = vec![steam_path.to_string()];
        libraries.extend(find_steam_library_paths(steam_path));

        for lib in libraries {
            for mut c in find_steam_library_candidates(&lib) {
                let app_id_opt = steam::resolve_steam_app_id_from_map(path_to_appid, &c.path);
                c.steam_app_id = app_id_opt.clone();

                if let Some(app_id) = app_id_opt {
                    let (folder_name, _, paths, path_display) =
                        extract_manifest_data(&app_id, &c.path, manifest_index);
                    c.folder_name = folder_name;
                    if paths.is_some() {
                        c.paths = paths;
                        c.path = path_display;
                    }
                }
                candidate_list.add(c);
            }
        }
    }

    fn is_steam_app_id_folder(name: &str) -> bool {
        name.len() >= 4 && name.len() <= 10 && name.chars().all(|c| c.is_ascii_digit())
    }

    fn contains_saves_at_any_depth(dir_path: &Path, depth: usize) -> bool {
        if depth > MAX_SCAN_DEPTH || !dir_path.exists() || !dir_path.is_dir() {
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

    pub fn scan_cracks(
        candidate_list: &mut CandidateList,
        manifest_index: &Option<manifest::ManifestIndex>,
    ) {
        for entry in paths::crack_save_locations() {
            let Some(base_path) = expand_path(&entry.path) else {
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
                    if !contains_saves_at_any_depth(&sub_path, 0) {
                        continue;
                    }
                    if let Some(p) = sub_path.to_str() {
                        let (folder_name, steam_app_id, _, _) =
                            extract_manifest_data(&sub_name, p, manifest_index);
                        candidate_list.add(PathCandidateDto {
                            path: p.to_string(),
                            folder_name,
                            base_path: format!("{} ({})", entry.label, base_path_display),
                            steam_app_id,
                            paths: None,
                        });
                    }
                } else {
                    for (app_dir, app_name) in list_subdirs(&sub_path) {
                        if app_name == "steam_settings" || app_name == "settings" {
                            continue;
                        }
                        if !is_steam_app_id_folder(&app_name)
                            || !contains_saves_at_any_depth(&app_dir, 0)
                        {
                            continue;
                        }

                        if let Some(p) = app_dir.to_str() {
                            let (folder_name, steam_app_id, _, _) =
                                extract_manifest_data(&app_name, p, manifest_index);
                            candidate_list.add(PathCandidateDto {
                                path: p.to_string(),
                                folder_name,
                                base_path: format!("{} ({})", entry.label, base_path_display),
                                steam_app_id,
                                paths: None,
                            });
                        }
                    }
                }
            }
        }
    }
}

fn base_scan_jobs(cfg: &config::Config) -> Vec<(String, String)> {
    let mut jobs: Vec<(String, String)> = paths::base_scan_templates()
        .into_iter()
        .filter_map(|entry| expand_path(&entry.path).map(|exp| (exp, entry.label.clone())))
        .collect();

    #[cfg(target_os = "windows")]
    {
        jobs.extend(windows_scanners::logical_drives().into_iter().map(|root| {
            let label = format!("Disco {}", root.trim_end_matches(&['\\', ':']));
            (root, label)
        }));
    }

    for extra in &cfg.custom_scan_paths {
        let trimmed = extra.trim();
        if trimmed.is_empty() {
            continue;
        }

        let path = expand_path(trimmed).unwrap_or_else(|| trimmed.to_string());
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

fn scan_path_candidates_sync(
    manifest_index: Option<crate::manifest::ManifestIndex>,
) -> Vec<PathCandidateDto> {
    let cfg = config::load_config();
    let mut list = CandidateList::new();

    // Escaneo paralelo de rutas base (mantenemos Rayon porque es muy rápido para el disco)
    let parallel_candidates: Vec<PathCandidateDto> = base_scan_jobs(&cfg)
        .par_iter()
        .flat_map(|(base_path, label)| scan_base_paths_into_vec(base_path, label))
        .collect();

    list.extend(parallel_candidates);

    #[cfg(target_os = "windows")]
    {
        let path_to_appid = steam::get_steam_path_to_appid_map();

        windows_scanners::scan_steam(&mut list, &path_to_appid, &manifest_index);
        windows_scanners::scan_cracks(&mut list, &manifest_index);
    }

    let (mut final_candidates, _) = list.into_inner();

    final_candidates.sort_by(|a, b| {
        a.base_path
            .cmp(&b.base_path)
            .then(a.folder_name.cmp(&b.folder_name))
    });

    final_candidates
}

#[tauri::command]
pub async fn scan_path_candidates() -> Result<Vec<PathCandidateDto>, String> {
    // Descargamos/cargamos el manifiesto de forma asíncrona primero.
    // Usamos .ok() para convertir el Result a Option, de modo que si falla la red,
    // el escáner siga funcionando (aunque con menor precisión al no tener el manifiesto).
    let manifest_index = crate::manifest::load_manifest_index_async().await.ok();

    // Mandamos la tarea pesada de leer el disco al pool de hilos de bloqueo
    tauri::async_runtime::spawn_blocking(move || scan_path_candidates_sync(manifest_index))
        .await
        .map_err(|e| format!("Error en el hilo de escaneo: {}", e))
}
