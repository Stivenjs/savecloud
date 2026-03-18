//! Escaneo de rutas candidatas para guardados.
//! Réplica de la lógica del CLI (FileSystemPathScanner).
//! Mejorado con el manifiesto de Ludusavi para nombres y rutas precisas (Steam y otros).

mod extensions;
mod filters;
mod paths;

use crate::config;
#[cfg(target_os = "windows")]
use crate::{manifest, steam};
use filters::{
    folder_contains_save_like_files, folder_name_hints_save, is_excluded_folder,
    GENERIC_INNER_FOLDERS,
};
use rayon::prelude::*;
use regex::Regex;
use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

static ENV_VAR_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"%([^%]+)%").unwrap());
static NUMBER_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+$").unwrap());

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PathCandidateDto {
    pub path: String,
    pub folder_name: String,
    pub base_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steam_app_id: Option<String>,
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

// Filtro de carpetas genéricas del sistema para evitar falsos positivos
fn is_common_root_dir(path_str: &str) -> bool {
    let mut p = path_str.to_lowercase();
    p = p.trim_end_matches(&['\\', '/']).to_string();

    // Filtra discos base (C:, D:, etc.)
    if p.len() <= 3 && p.ends_with(':') {
        return true;
    }

    let user_profile = std::env::var("USERPROFILE")
        .unwrap_or_default()
        .to_lowercase();
    let public = std::env::var("PUBLIC")
        .unwrap_or_else(|_| "c:\\users\\public".to_string())
        .to_lowercase();
    let appdata = std::env::var("APPDATA").unwrap_or_default().to_lowercase();
    let localappdata = std::env::var("LOCALAPPDATA")
        .unwrap_or_default()
        .to_lowercase();

    let common = vec![
        user_profile.clone(),
        appdata,
        localappdata.clone(),
        format!("{}\\locallow", user_profile),
        format!("{}\\documents", user_profile),
        format!("{}\\saved games", user_profile),
        format!("{}\\packages", localappdata),
        format!("{}\\steam", localappdata),
        public.clone(),
        format!("{}\\documents", public),
    ];

    common.contains(&p)
}

fn expand_path(raw: &str) -> Option<String> {
    let mut result = raw.to_string();

    for cap in ENV_VAR_REGEX.captures_iter(raw) {
        if let Some(var) = cap.get(1) {
            let var_str = var.as_str();
            let val = std::env::var(var_str).unwrap_or_default();
            result = result.replace(&format!("%{}%", var_str), &val);
        }
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
            let name_lower = name.to_lowercase();

            if name.starts_with('.')
                || name_lower == "7"
                || name_lower == "241100"
                || name_lower == "steam controller configs"
            {
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

    let mut candidates = Vec::new();

    for (l1_path, l1_name) in list_subdirs(base) {
        if is_excluded_folder(&l1_name) {
            continue;
        }

        if !folder_contains_save_like_files(&l1_path) {
            continue;
        }

        let mut found_valid_l2 = false;

        for (l2_path, l2_name) in list_subdirs(&l1_path) {
            if is_excluded_folder(&l2_name) {
                continue;
            }

            let l2_lower = l2_name.to_lowercase();

            if folder_name_hints_save(&l2_name)
                || NUMBER_REGEX.is_match(&l2_name)
                || GENERIC_INNER_FOLDERS.contains(&l2_lower)
            {
                continue;
            }

            if folder_contains_save_like_files(&l2_path) {
                found_valid_l2 = true;
                candidates.push(PathCandidateDto {
                    path: l2_path.to_string_lossy().to_string(),
                    folder_name: format!("{} ({})", l2_name, l1_name),
                    base_path: base_label.to_string(),
                    steam_app_id: None,
                    paths: None,
                });
            }
        }

        if !found_valid_l2 {
            candidates.push(PathCandidateDto {
                path: l1_path.to_string_lossy().to_string(),
                folder_name: l1_name,
                base_path: base_label.to_string(),
                steam_app_id: None,
                paths: None,
            });
        }
    }

    candidates
}

#[cfg(target_os = "windows")]
mod windows_scanners {
    use super::*;

    static VDF_PATH_REGEX: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#""path"\s+"([^"]+)""#).unwrap());

    const MAX_SCAN_DEPTH: usize = 5;

    pub fn logical_drives() -> Vec<String> {
        (b'A'..=b'Z')
            .map(|c| format!("{}:\\", c as char))
            .filter(|root| Path::new(root).exists() && fs::read_dir(root).is_ok())
            .collect()
    }

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

    fn find_steam_library_candidates(
        library_path: &str,
        path_to_appid: &std::collections::HashMap<PathBuf, String>,
    ) -> Vec<PathCandidateDto> {
        let common = Path::new(library_path).join("steamapps").join("common");
        if !common.exists() || !common.is_dir() {
            return vec![];
        }

        list_subdirs(&common)
            .into_iter()
            .filter_map(|(full_path, name)| {
                if is_excluded_folder(&name) {
                    return None;
                }

                let path_str = full_path.to_string_lossy().to_string();

                let is_steam_game =
                    steam::resolve_steam_app_id_from_map(path_to_appid, &path_str).is_some();
                let passes_heuristic = folder_contains_save_like_files(&full_path);

                if is_steam_game || passes_heuristic {
                    Some(PathCandidateDto {
                        path: path_str,
                        folder_name: name,
                        base_path: format!("Steam Library ({})", library_path),
                        steam_app_id: None,
                        paths: None,
                    })
                } else {
                    None
                }
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
            for mut c in find_steam_library_candidates(&lib, path_to_appid) {
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

#[cfg(target_os = "windows")]
fn read_registry_install_dir(full_path: &str) -> Option<String> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    let parts: Vec<&str> = full_path.splitn(2, '\\').collect();
    if parts.len() != 2 {
        return None;
    }

    let hive_str = parts[0];
    let rest = parts[1];

    if let Some(last_slash) = rest.rfind('\\') {
        let subkey_str = &rest[..last_slash];
        let value_name = &rest[last_slash + 1..];

        let hive = match hive_str {
            "HKEY_LOCAL_MACHINE" => RegKey::predef(HKEY_LOCAL_MACHINE),
            "HKEY_CURRENT_USER" => RegKey::predef(HKEY_CURRENT_USER),
            _ => return None,
        };

        let subkeys_to_try = [
            subkey_str.to_string(),
            subkey_str.replace("SOFTWARE\\", "SOFTWARE\\WOW6432Node\\"),
        ];

        for key in subkeys_to_try {
            if let Ok(subkey) = hive.open_subkey(&key) {
                if let Ok(val) = subkey.get_value::<String, _>(value_name) {
                    let clean_val = val
                        .trim_matches('"')
                        .trim_end_matches(['\\', '/'])
                        .to_string();
                    if !clean_val.is_empty() {
                        return Some(clean_val);
                    }
                }
            }
        }
    }
    None
}

fn scan_path_candidates_sync(
    #[cfg(target_os = "windows")] manifest_index: Option<crate::manifest::ManifestIndex>,
) -> Vec<PathCandidateDto> {
    let cfg = config::load_config();
    let mut list = CandidateList::new();

    // ==========================================================
    // FASE 0: Escaneo Activo desde la Base de Datos (MULTIHILO SÚPER RÁPIDO)
    // ==========================================================
    #[cfg(target_os = "windows")]
    if let Some(manifest) = &manifest_index {
        let mut unique_entries = Vec::new();
        let mut seen = HashSet::new();
        for entry in manifest.values() {
            if seen.insert(&entry.name) {
                unique_entries.push(entry);
            }
        }

        let active_candidates: Vec<PathCandidateDto> = unique_entries
            .par_iter()
            .filter_map(|entry| {
                let mut valid_game_paths = Vec::new();

                let mut install_dir_cache: Option<String> = None;
                if let Some(reg_path) = &entry.registry_path {
                    install_dir_cache = read_registry_install_dir(reg_path);
                }

                for template in &entry.save_paths {
                    let expanded_path_opt = match template {
                        crate::manifest::PathTemplate::Absolute(_) => {
                            Some(crate::manifest::resolve_path_template(template, None))
                        }
                        crate::manifest::PathTemplate::RelativeToInstall(_) => {
                            install_dir_cache.as_ref().map(|install_dir| {
                                crate::manifest::resolve_path_template(template, Some(install_dir))
                            })
                        }
                    };

                    if let Some(expanded) = expanded_path_opt {
                        let clean_path_str = if let Some(idx) = expanded.find('*') {
                            let before = &expanded[..idx];
                            if let Some(sep) = before.rfind(|c| c == '\\' || c == '/') {
                                before[..sep].to_string()
                            } else {
                                before.to_string()
                            }
                        } else {
                            expanded.clone()
                        };

                        let path = Path::new(&clean_path_str);

                        if path.exists() {
                            let folder_path = if path.is_file() {
                                path.parent().unwrap_or(path).to_string_lossy().to_string()
                            } else {
                                clean_path_str.clone()
                            };

                            // Filtramos directorios genéricos vacíos (ej. C:\, AppData\Local, etc.)
                            if Path::new(&folder_path).is_dir() && !is_common_root_dir(&folder_path)
                            {
                                if std::fs::read_dir(&folder_path)
                                    .map(|mut i| i.next().is_some())
                                    .unwrap_or(false)
                                {
                                    if !valid_game_paths.contains(&folder_path) {
                                        valid_game_paths.push(folder_path);
                                    }
                                }
                            }
                        }
                    }
                }

                // AGRUPACIÓN: Si un juego de Ludusavi tiene múltiples rutas, las agrupamos en un solo DTO.
                if !valid_game_paths.is_empty() {
                    let display_path = valid_game_paths[0].clone();
                    let paths_opt = if valid_game_paths.len() > 1 {
                        Some(valid_game_paths)
                    } else {
                        None
                    };

                    Some(PathCandidateDto {
                        path: display_path,
                        folder_name: entry.name.clone(),
                        base_path: "Base de Datos Oficial".to_string(),
                        steam_app_id: None,
                        paths: paths_opt,
                    })
                } else {
                    None
                }
            })
            .collect();

        list.extend(active_candidates);
    }
    // ==========================================================

    let parallel_candidates: Vec<PathCandidateDto> = base_scan_jobs(&cfg)
        .par_iter()
        .flat_map(|(base_path, label)| scan_base_paths_into_vec(base_path, label))
        .collect();

    list.extend(parallel_candidates);

    #[cfg(target_os = "windows")]
    {
        let path_to_appid = crate::steam::get_steam_path_to_appid_map();
        windows_scanners::scan_steam(&mut list, &path_to_appid, &manifest_index);
        windows_scanners::scan_cracks(&mut list, &manifest_index);
    }

    let (final_candidates, _) = list.into_inner();

    // ==========================================================
    // ELIMINADOR DE REDUNDANCIAS (Sabueso vs Fase 0)
    // ==========================================================
    let mut filtered_candidates = Vec::new();
    for cand in &final_candidates {
        if cand.base_path != "Base de Datos Oficial" {
            // Si el sabueso encontró una carpeta, verificamos que no sea redundante.
            // Ej: Sabueso encontró "AppData/Local/DeadIsland".
            // Ludusavi ya tiene "AppData/Local/DeadIsland/Saved". Borramos la del Sabueso.
            let is_redundant = final_candidates.iter().any(|official| {
                if official.base_path == "Base de Datos Oficial" {
                    let cand_path_lower = cand.path.to_lowercase();

                    let mut official_paths = vec![official.path.to_lowercase()];
                    if let Some(extra_paths) = &official.paths {
                        for ep in extra_paths {
                            official_paths.push(ep.to_lowercase());
                        }
                    }

                    official_paths.iter().any(|op| {
                        op.starts_with(&cand_path_lower) && op.len() > cand_path_lower.len()
                    })
                } else {
                    false
                }
            });

            if is_redundant {
                continue;
            }
        }
        filtered_candidates.push(cand.clone());
    }

    filtered_candidates.sort_by(|a, b| {
        a.base_path
            .cmp(&b.base_path)
            .then(a.folder_name.cmp(&b.folder_name))
    });

    filtered_candidates
}

#[tauri::command]
pub async fn scan_path_candidates() -> Result<Vec<PathCandidateDto>, String> {
    #[cfg(target_os = "windows")]
    let manifest_index = crate::manifest::load_manifest_index_async().await.ok();

    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "windows")]
        {
            scan_path_candidates_sync(manifest_index)
        }
        #[cfg(not(target_os = "windows"))]
        {
            scan_path_candidates_sync()
        }
    })
    .await
    .map_err(|e| format!("Error en el hilo de escaneo: {}", e))
}
