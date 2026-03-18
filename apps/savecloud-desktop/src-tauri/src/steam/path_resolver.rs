//! Detección automática de Steam App ID a partir de rutas de guardados.
//! Escanea las bibliotecas de Steam y asocia rutas de juego con sus app IDs.


use std::collections::HashMap;
use std::path::PathBuf; 

#[cfg(target_os = "windows")]
use regex::Regex;

#[cfg(target_os = "windows")]
use std::fs;

#[cfg(target_os = "windows")]
use std::path::Path; 

#[cfg(target_os = "windows")]
use std::sync::LazyLock;

#[cfg(target_os = "windows")]
static VDF_PATH_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#""path"\s+"([^"]+)""#).unwrap());

#[cfg(target_os = "windows")]
static ENV_VAR_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"%([^%]+)%").unwrap());

/// Limpia el prefijo UNC (\\?\) que añade `canonicalize` en Windows.
#[cfg(target_os = "windows")]
fn clean_unc_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if s.starts_with(r"\\?\") {
        PathBuf::from(s[4..].to_string())
    } else {
        path.to_path_buf()
    }
}

/// Expande variables de entorno como %APPDATA%.
#[cfg(target_os = "windows")]
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
#[cfg(target_os = "windows")]
fn normalize_path(s: &str) -> PathBuf {
    let expanded = expand_env_vars(s);
    let path = PathBuf::from(&expanded);

    if let Ok(canonical) = path.canonicalize() {
        clean_unc_path(&canonical)
    } else {
        path
    }
}

/// Rutas posibles de Steam en Windows.
#[cfg(target_os = "windows")]
fn steam_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(path) = read_steam_path_from_registry() {
        candidates.push(path);
    }

    candidates.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    candidates.push(PathBuf::from(r"C:\Program Files\Steam"));

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
#[cfg(target_os = "windows")]
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
#[cfg(target_os = "windows")]
fn parse_libraryfolders_vdf(content: &str) -> Option<Vec<PathBuf>> {
    let paths: Vec<PathBuf> = VDF_PATH_REGEX
        .captures_iter(content)
        .filter_map(|cap| cap.get(1))
        .map(|m| PathBuf::from(m.as_str().replace("\\\\", "\\")))
        .filter(|p| p.is_dir())
        .collect();

    if paths.is_empty() {
        None
    } else {
        Some(paths)
    }
}

/// Parsea appmanifest_*.acf
#[cfg(target_os = "windows")]
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
#[cfg(target_os = "windows")]
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

/// Construye el mapa ruta -> Steam AppID (Windows).
#[cfg(target_os = "windows")]
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

/// Stub para Linux/macOS para evitar warnings.
#[cfg(not(target_os = "windows"))]
pub fn get_steam_path_to_appid_map() -> HashMap<PathBuf, String> {
    HashMap::new()
}

/// Busca el appid desde una ruta.
pub fn resolve_steam_app_id_from_map(
    path_to_appid: &HashMap<PathBuf, String>,
    game_path: &str,
) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let normalized = normalize_path(game_path);

        let mut best: Option<(&PathBuf, &String)> = None;

        for (steam_game_path, appid) in path_to_appid {
            if normalized.starts_with(steam_game_path) {
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

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path_to_appid; 
        let _ = game_path; 
        None
    }
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
