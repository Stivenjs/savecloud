//! Módulo de escaneo de rutas candidatas para guardados.
//!
//! Implementa la lógica de escaneo de rutas candidatas para guardados,
//! incluyendo:
//!
//! - Escaneo de rutas candidatas para Windows.
//! - Escaneo de rutas candidatas para Unix.
//! - Escaneo de rutas candidatas para Steam.
//! - Escaneo de rutas candidatas para Ludusavi.
//! - Escaneo de rutas candidatas para otros juegos.

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
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

static ENV_VAR_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"%([^%]+)%").unwrap());
static NUMBER_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\d+$").unwrap());

static COMMON_ROOT_DIRS: LazyLock<HashSet<String>> = LazyLock::new(|| {
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

    [
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
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect()
});

struct EnvContext {
    user_profile: String,
    home: String,
}

impl EnvContext {
    fn resolve() -> Self {
        let user_profile = std::env::var("USERPROFILE").unwrap_or_default();
        let home = std::env::var("HOME").unwrap_or_default();
        Self { user_profile, home }
    }
}

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

/// Colección de candidatos con dedup por path (case-insensitive) y ordenación
/// implícita por `(base_path, folder_name)` mediante un `BTreeMap`.
///
/// Usar `BTreeMap` elimina el `sort_by()` final: cada inserción mantiene el
/// orden, de modo que `into_vec()` devuelve la lista ya ordenada en O(1).
struct CandidateList {
    map: BTreeMap<(String, String), PathCandidateDto>,
    seen: HashSet<String>,
}

impl CandidateList {
    fn new() -> Self {
        Self {
            map: BTreeMap::new(),
            seen: HashSet::new(),
        }
    }

    /// Inserta un candidato si su path no ha sido visto antes.
    /// La clave del `BTreeMap` ordena automáticamente por `(base_path, folder_name)`.
    fn add(&mut self, candidate: PathCandidateDto) {
        let path_key = candidate.path.to_lowercase();
        if self.seen.insert(path_key) {
            let sort_key = (
                candidate.base_path.to_lowercase(),
                candidate.folder_name.to_lowercase(),
            );
            self.map.insert(sort_key, candidate);
        }
    }

    fn extend(&mut self, items: impl IntoIterator<Item = PathCandidateDto>) {
        for item in items {
            self.add(item);
        }
    }

    fn into_vec(self) -> Vec<PathCandidateDto> {
        self.map.into_values().collect()
    }
}

/// Devuelve `true` si el path es una raíz genérica del sistema.
fn is_common_root_dir(path_str: &str) -> bool {
    let mut p = path_str.to_lowercase();
    p = p.trim_end_matches(&['\\', '/']).to_string();

    // Discos base (C:, D:, …)
    if p.len() <= 3 && p.ends_with(':') {
        return true;
    }

    COMMON_ROOT_DIRS.contains(&p)
}

fn expand_path(raw: &str, env: &EnvContext) -> Option<String> {
    let mut result = raw.to_string();

    for cap in ENV_VAR_REGEX.captures_iter(raw) {
        if let Some(var) = cap.get(1) {
            let var_str = var.as_str();
            let val = std::env::var(var_str).unwrap_or_default();
            result = result.replace(&format!("%{}%", var_str), &val);
        }
    }

    if result.starts_with('~') {
        let home = if !env.user_profile.is_empty() {
            &env.user_profile
        } else {
            &env.home
        };
        if !home.is_empty() {
            let rest = result.trim_start_matches('~').trim_start_matches('/');
            result = if rest.is_empty() {
                home.clone()
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

/// Lista subdirectorios de `dir_path` excluyendo carpetas irrelevantes.
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

/// Devuelve `true` si el nombre es un app ID de Steam válido (4-10 dígitos).
/// Se usa tanto aquí como en `windows_scanners`.
fn is_steam_app_id_folder(name: &str) -> bool {
    name.len() >= 4 && name.len() <= 10 && name.chars().all(|c| c.is_ascii_digit())
}

/// Escanea un directorio base en busca de candidatos con dos niveles de
/// profundidad (L1 → L2), aplicando heurísticas de filtrado.
fn scan_base_paths_into_vec(base_path: &str, base_label: &str) -> Vec<PathCandidateDto> {
    let base = Path::new(base_path);
    if !base.exists() || !base.is_dir() {
        return vec![];
    }

    let mut candidates = Vec::new();

    // Si el directorio base es una carpeta de emulador de Steam (ej. "GSE Saves",
    // "Goldberg Steam Emu Saves"), sus subdirectorios directos son app IDs numéricos.
    // Detectamos ese contexto aquí para propagar el steam_app_id al candidato,
    // permitiendo que el frontend resuelva el número al nombre real del juego.
    let base_folder_name = base.file_name().and_then(|n| n.to_str()).unwrap_or("");
    let base_is_steam_emu = filters::folder_name_hints_steam_emu(base_folder_name);

    for (l1_path, l1_name) in list_subdirs(base) {
        if is_excluded_folder(&l1_name) {
            continue;
        }

        // Caso 1: el base ya es emulador y L1 es directamente un app ID numérico.
        let l1_is_app_id_in_emu_base = base_is_steam_emu && is_steam_app_id_folder(&l1_name);

        // Caso 2: L1 es él mismo un directorio de emulador Steam (ej. "GSE Saves"
        // aparece como subdirectorio de %APPDATA%). En este caso hay que descender
        // un nivel más y tratar sus hijos como app IDs.
        let l1_is_emu_dir = !base_is_steam_emu && filters::folder_name_hints_steam_emu(&l1_name);

        if l1_is_emu_dir {
            // Iterar los hijos de L1 como app IDs (L2 = app ID).
            for (l2_path, l2_name) in list_subdirs(&l1_path) {
                if l2_name == "steam_settings" || l2_name == "settings" {
                    continue;
                }
                if !is_steam_app_id_folder(&l2_name) {
                    continue;
                }
                let is_empty = fs::read_dir(&l2_path)
                    .map(|mut i| i.next().is_none())
                    .unwrap_or(true);
                if is_empty {
                    continue;
                }
                candidates.push(PathCandidateDto {
                    path: l2_path.to_string_lossy().to_string(),
                    folder_name: l2_name.clone(),
                    base_path: base_label.to_string(),
                    steam_app_id: Some(l2_name),
                    paths: None,
                });
            }
            // No emitir la carpeta raíz del emulador como candidato.
            continue;
        }

        if l1_is_app_id_in_emu_base {
            // Emitir la carpeta del app ID directamente sin escanear L2.
            let is_empty = fs::read_dir(&l1_path)
                .map(|mut i| i.next().is_none())
                .unwrap_or(true);
            if is_empty {
                continue;
            }
            let app_id = l1_name.clone();
            candidates.push(PathCandidateDto {
                path: l1_path.to_string_lossy().to_string(),
                folder_name: l1_name,
                base_path: base_label.to_string(),
                steam_app_id: Some(app_id),
                paths: None,
            });
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

    /// Devuelve todas las unidades lógicas disponibles (A:\ … Z:\).
    pub fn logical_drives() -> Vec<String> {
        (b'A'..=b'Z')
            .map(|c| format!("{}:\\", c as char))
            .filter(|root| Path::new(root).exists() && fs::read_dir(root).is_ok())
            .collect()
    }

    /// Extrae nombre, app_id y paths adicionales del índice del manifiesto.
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

    /// Escanea `<steam>/userdata/<user_id>/<app_id>/remote`.
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

    /// Lee `libraryfolders.vdf` y devuelve las rutas de librerías adicionales.
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

    /// Escanea `<library>/steamapps/common` en busca de instalaciones de juegos.
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

    /// Punto de entrada del scanner de Steam.
    ///
    /// Las librerías adicionales se escanean en paralelo con `par_iter()`
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

        let lib_candidates: Vec<PathCandidateDto> = libraries
            .par_iter()
            .flat_map(|lib| {
                let mut results = find_steam_library_candidates(lib, path_to_appid);
                for c in &mut results {
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
                }
                results
            })
            .collect();

        candidate_list.extend(lib_candidates);
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

    /// Escanea ubicaciones de guardados de versiones "crackeadas" / emuladas.
    pub fn scan_cracks(
        candidate_list: &mut CandidateList,
        manifest_index: &Option<manifest::ManifestIndex>,
        env: &EnvContext,
    ) {
        for entry in paths::crack_save_locations() {
            let Some(base_path) = expand_path(&entry.path, env) else {
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
                    // Las crack_save_locations son rutas de confianza (emuladores Steam):
                    // cualquier subcarpeta numérica válida es un candidato, incluso si
                    // sus archivos de guardado están dentro de "settings/" u otras
                    // subcarpetas que contains_saves_at_any_depth omite.
                    // Solo descartamos si el directorio está completamente vacío.
                    let is_empty = fs::read_dir(&sub_path)
                        .map(|mut i| i.next().is_none())
                        .unwrap_or(true);
                    if is_empty {
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

fn base_scan_jobs(cfg: &config::Config, env: &EnvContext) -> Vec<(String, String)> {
    let mut jobs: Vec<(String, String)> = paths::base_scan_templates()
        .into_iter()
        .filter_map(|entry| expand_path(&entry.path, env).map(|exp| (exp, entry.label.clone())))
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
        let path = expand_path(trimmed, env).unwrap_or_else(|| trimmed.to_string());
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

/// Construye un `HashSet` con todos los paths oficiales (y sus variantes en
/// `paths`) normalizados a minúsculas.
///
/// Este índice permite que el filtro de redundancia opere en O(1) por
/// candidato en lugar de iterar toda la lista en cada comprobación (O(n²)).
#[cfg(target_os = "windows")]
fn build_official_path_index(candidates: &[PathCandidateDto]) -> HashSet<String> {
    let mut index = HashSet::new();
    for c in candidates {
        if c.base_path == "Base de Datos Oficial" {
            index.insert(c.path.to_lowercase());
            if let Some(extra_paths) = &c.paths {
                for ep in extra_paths {
                    index.insert(ep.to_lowercase());
                }
            }
        }
    }
    index
}

pub fn scan_path_candidates_sync(
    #[cfg(target_os = "windows")] manifest_index: Option<crate::manifest::ManifestIndex>,
) -> Vec<PathCandidateDto> {
    let cfg = config::load_config();
    let env = EnvContext::resolve();
    let mut list = CandidateList::new();

    #[cfg(target_os = "windows")]
    if let Some(manifest) = &manifest_index {
        let mut unique_entries = Vec::new();
        let mut seen_names = HashSet::new();
        for entry in manifest.values() {
            if seen_names.insert(&entry.name) {
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

                            if Path::new(&folder_path).is_dir()
                                && !is_common_root_dir(&folder_path)
                                && fs::read_dir(&folder_path)
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

    let parallel_candidates: Vec<PathCandidateDto> = base_scan_jobs(&cfg, &env)
        .par_iter()
        .flat_map(|(base_path, label)| scan_base_paths_into_vec(base_path, label))
        .collect();

    list.extend(parallel_candidates);

    #[cfg(target_os = "windows")]
    {
        let path_to_appid = crate::steam::get_steam_path_to_appid_map();
        windows_scanners::scan_steam(&mut list, &path_to_appid, &manifest_index);
        windows_scanners::scan_cracks(&mut list, &manifest_index, &env);
    }

    let all_candidates = list.into_vec();

    #[cfg(target_os = "windows")]
    let official_index = build_official_path_index(&all_candidates);
    #[cfg(not(target_os = "windows"))]
    let official_index: HashSet<String> = HashSet::new();

    all_candidates
        .into_iter()
        .filter(|cand| {
            if cand.base_path == "Base de Datos Oficial" {
                return true;
            }

            let cand_path_lower = cand.path.to_lowercase();

            let is_redundant = official_index
                .iter()
                .any(|op| op.starts_with(&cand_path_lower) && op.len() > cand_path_lower.len());

            !is_redundant
        })
        .collect()
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
