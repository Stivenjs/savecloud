//! Detección automática de Steam App ID a partir de rutas de guardados.
//! Escanea las bibliotecas de Steam y asocia rutas de juego con sus app IDs.

use regex::Regex;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

static VDF_PATH_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""path"\s+"([^"]+)""#).unwrap());

static ENV_VAR_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"%([^%]+)%").unwrap());

/// Limpia el prefijo UNC (\\?\) que añade `canonicalize` en Windows.
fn clean_unc_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

/// Expande variables de entorno como %APPDATA%.
fn expand_env_vars(s: &str) -> String {
    let mut result = s.to_string();

    for cap in ENV_VAR_REGEX.captures_iter(s) {
        if let Some(var) = cap.get(1) {
            let var_str = var.as_str();
            if let Ok(val) = std::env::var(var_str) {
                result = result.replace(&format!("%{}%", var_str), &val);
            }
        }
    }

    result
}

/// Normaliza una ruta para comparación.
fn normalize_path(s: &str) -> PathBuf {
    let expanded = expand_env_vars(s);
    let path = PathBuf::from(&expanded);

    if let Ok(canonical) = path.canonicalize() {
        clean_unc_path(&canonical)
    } else {
        path
    }
}

/// Rutas posibles de Steam en diferentes sistemas operativos.
pub fn steam_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Ok(path) = read_steam_path_from_registry() {
            candidates.push(path);
        }
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
        candidates.push(PathBuf::from(r"C:\Program Files\Steam"));
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            candidates.push(home.join("Library/Application Support/Steam"));
        }
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            candidates.push(home.join(".local/share/Steam"));
            candidates.push(home.join(".steam/steam"));
            candidates.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
        }
    }

    candidates
}

#[cfg(target_os = "windows")]
fn read_steam_path_from_registry() -> Result<PathBuf, std::io::Error> {
    use std::io;
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SOFTWARE\WOW6432Node\Valve\Steam")
        .and_then(|k| k.get_value::<String, _>("InstallPath"))
        .map(PathBuf::from)
        .map_err(|e| io::Error::new(io::ErrorKind::NotFound, e))
}

/// Lee libraryfolders.vdf y extrae las rutas de las bibliotecas.
fn read_library_paths(steam_root: &Path) -> Vec<PathBuf> {
    let vdf_paths = [
        steam_root.join("steamapps").join("libraryfolders.vdf"),
        steam_root.join("config").join("libraryfolders.vdf"),
    ];

    for vdf_path in &vdf_paths {
        if let Ok(content) = fs::read_to_string(vdf_path) {
            if let Some(paths) = parse_libraryfolders_vdf(&content) {
                return paths;
            }
        }
    }

    if steam_root.join("steamapps").is_dir() {
        return vec![steam_root.to_path_buf()];
    }

    Vec::new()
}

/// Extrae las rutas del VDF.
fn parse_libraryfolders_vdf(content: &str) -> Option<Vec<PathBuf>> {
    let paths: Vec<PathBuf> = VDF_PATH_REGEX
        .captures_iter(content)
        .filter_map(|cap| cap.get(1))
        .map(|m| PathBuf::from(m.as_str().replace("\\\\", "/").replace("\\", "/")))
        .filter(|p| p.is_dir())
        .collect();

    if paths.is_empty() {
        None
    } else {
        Some(paths)
    }
}

/// Parsea appmanifest_*.acf
fn parse_appmanifest(content: &str) -> Option<(String, String)> {
    let mut appid = None;
    let mut installdir = None;

    for line in content.lines() {
        let line = line.trim();
        let line_lower = line.to_lowercase();

        if line_lower.starts_with("\"appid\"") {
            appid = line.split('"').nth(3).map(|s| s.to_string());
        } else if line_lower.starts_with("\"installdir\"") {
            installdir = line.split('"').nth(3).map(|s| s.to_string());
        }

        if appid.is_some() && installdir.is_some() {
            break;
        }
    }

    match (appid, installdir) {
        (Some(a), Some(i)) if !a.is_empty() && !i.is_empty() => Some((a, i)),
        _ => None,
    }
}

/// Construye el mapa path -> appid.
fn build_path_to_appid_map(library_paths: &[PathBuf]) -> HashMap<PathBuf, String> {
    let mut map = HashMap::new();

    for lib in library_paths {
        let steamapps = lib.join("steamapps");
        if !steamapps.is_dir() {
            continue;
        }

        let entries = match fs::read_dir(&steamapps) {
            Ok(e) => e,
            Err(_) => continue,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            if name.starts_with("appmanifest_") && name.ends_with(".acf") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Some((appid, installdir)) = parse_appmanifest(&content) {
                        let game_path = steamapps.join("common").join(&installdir);

                        if let Ok(canonical) = game_path.canonicalize() {
                            map.insert(clean_unc_path(&canonical), appid);
                        }
                    }
                }
            }
        }
    }

    map
}

/// Construye el mapa ruta -> Steam AppID.
pub fn get_steam_path_to_appid_map() -> HashMap<PathBuf, String> {
    let Some(steam_root) = steam_path_candidates()
        .into_iter()
        .find(|p| p.join("steamapps").is_dir())
    else {
        return HashMap::new();
    };

    let library_paths = read_library_paths(&steam_root);
    build_path_to_appid_map(&library_paths)
}

/// Busca el appid desde una ruta.
pub fn resolve_steam_app_id_from_map(
    path_to_appid: &HashMap<PathBuf, String>,
    game_path: &str,
) -> Option<String> {
    let normalized = normalize_path(game_path);
    let normalized_str = normalized.to_string_lossy().to_lowercase();

    let mut best: Option<(&PathBuf, &String)> = None;

    for (steam_game_path, appid) in path_to_appid {
        let steam_game_str = steam_game_path.to_string_lossy().to_lowercase();
        if normalized_str.starts_with(&steam_game_str) {
            let current_components = steam_game_path.components().count();
            let best_components = best
                .as_ref()
                .map(|(p, _)| p.components().count())
                .unwrap_or(0);

            if best_components < current_components {
                best = Some((steam_game_path, appid));
            }
        }
    }

    best.map(|(_, id)| id.clone())
}

/// Busca la carpeta de instalación en `steamapps/common` para un App ID.
pub fn resolve_steam_install_dir(app_id: &str) -> Option<PathBuf> {
    let app_id = app_id.trim();
    if app_id.is_empty() {
        return None;
    }

    get_steam_path_to_appid_map()
        .into_iter()
        .find(|(_, id)| id == app_id)
        .map(|(path, _)| path)
}

/// Resuelve el Steam AppID para un juego.
pub fn resolve_app_id_for_game(
    game_paths: &[String],
    path_to_appid: &HashMap<PathBuf, String>,
) -> Option<String> {
    for path in game_paths {
        if let Some(appid) = resolve_steam_app_id_from_map(path_to_appid, path) {
            return Some(appid);
        }
    }

    None
}
