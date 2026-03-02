//! Detección automática de Steam App ID a partir de rutas de guardados.
//! Escanea las bibliotecas de Steam y asocia rutas de juego con sus app IDs.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Rutas posibles de Steam según plataforma.
fn steam_path_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    #[cfg(target_os = "windows")]
    {
        // Registry: HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Valve\Steam
        if let Ok(path) = read_steam_path_from_registry() {
            candidates.push(path);
        }
        candidates.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
        candidates.push(PathBuf::from(r"C:\Program Files\Steam"));
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join(".steam/steam"));
            candidates.push(home.join(".local/share/Steam"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join("Library/Application Support/Steam"));
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

    // Fallback: la raíz de Steam es una biblioteca
    if steam_root.join("steamapps").is_dir() {
        return vec![steam_root.to_path_buf()];
    }

    Vec::new()
}

/// Extrae las rutas "path" del VDF. Formato simplificado.
fn parse_libraryfolders_vdf(content: &str) -> Option<Vec<PathBuf>> {
    let mut paths = Vec::new();

    for line in content.lines() {
        let line = line.trim();
        if !line.to_lowercase().contains("\"path\"") {
            continue;
        }
        // Buscar valor entre comillas (el que viene después de "path")
        let mut in_quotes = false;
        let mut start = 0;
        let mut found_path_key = false;
        let mut i = 0;
        let chars: Vec<char> = line.chars().collect();

        while i < chars.len() {
            if chars[i] == '"' {
                if !in_quotes {
                    start = i + 1;
                    in_quotes = true;
                } else {
                    let s: String = chars[start..i].iter().collect();
                    if found_path_key {
                        // En VDF las barras van escapadas: "D:\\Program Files"
                        let p = PathBuf::from(s.replace("\\\\", "\\"));
                        if p.is_dir() {
                            paths.push(p);
                        }
                        break;
                    }
                    if s.eq_ignore_ascii_case("path") {
                        found_path_key = true;
                    }
                    in_quotes = false;
                }
            }
            i += 1;
        }
    }

    Some(paths).filter(|p| !p.is_empty())
}

/// Parsea un archivo appmanifest_*.acf y devuelve (appid, installdir).
fn parse_appmanifest(content: &str) -> Option<(String, String)> {
    let appid = content
        .split_whitespace()
        .collect::<Vec<_>>()
        .windows(2)
        .find(|w| w[0].trim_matches('"').eq_ignore_ascii_case("appid"))
        .and_then(|w| w.get(1).map(|s| s.trim_matches('"').to_string()));

    let installdir = content
        .split_whitespace()
        .collect::<Vec<_>>()
        .windows(2)
        .find(|w| w[0].trim_matches('"').eq_ignore_ascii_case("installdir"))
        .and_then(|w| w.get(1).map(|s| s.trim_matches('"').to_string()));

    match (appid, installdir) {
        (Some(a), Some(i)) if !a.is_empty() && !i.is_empty() => Some((a, i)),
        _ => None,
    }
}

/// Construye el mapa: prefijo de ruta canónica -> appid.
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
                            map.insert(canonical, appid);
                        }
                    }
                }
            }
        }
    }

    map
}

/// Normaliza una ruta para comparación (expande env vars, canonicaliza si existe).
fn normalize_path(s: &str) -> PathBuf {
    let expanded = expand_env_vars(s);
    let path = PathBuf::from(&expanded);
    path.canonicalize().unwrap_or(path)
}

/// Expande variables de entorno como %APPDATA% en Windows.
fn expand_env_vars(s: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        use std::env;

        let mut result = s.to_string();
        let mut i = 0;
        while let Some(start) = result[i..].find('%') {
            let start = i + start;
            if let Some(end) = result[start + 1..].find('%') {
                let end = start + 1 + end;
                let var = &result[start + 1..end];
                if let Ok(val) = env::var(var) {
                    result = format!("{}{}{}", &result[..start], val, &result[end + 1..]);
                    i = start;
                } else {
                    i = end + 1;
                }
            } else {
                break;
            }
        }
        result
    }

    #[cfg(not(target_os = "windows"))]
    s.to_string()
}

/// Dado un mapa de rutas -> appid y una ruta de juego, devuelve el appid si la ruta
/// está dentro de algún directorio de instalación de Steam.
pub fn resolve_steam_app_id(
    path_to_appid: &HashMap<PathBuf, String>,
    game_path: &str,
) -> Option<String> {
    let normalized = normalize_path(game_path);

    // La ruta del juego puede ser un subdirectorio (ej. userdata/...). Buscar el prefijo más largo.
    let mut best: Option<(&PathBuf, &String)> = None;
    for (steam_game_path, appid) in path_to_appid {
        if normalized.starts_with(steam_game_path) {
            if best
                .as_ref()
                .map(|(p, _)| p.components().count())
                .unwrap_or(0)
                < steam_game_path.components().count()
            {
                best = Some((steam_game_path, appid));
            }
        }
    }
    best.map(|(_, id)| id.clone())
}

/// Resuelve el Steam App ID para un juego dado sus rutas.
/// Solo aplica si el juego no tiene ya steamAppId ni imageUrl.
pub fn resolve_app_id_for_game(game_paths: &[String]) -> Option<String> {
    let steam_root = steam_path_candidates()
        .into_iter()
        .find(|p| p.join("steamapps").is_dir())?;

    let library_paths = read_library_paths(&steam_root);
    let path_to_appid = build_path_to_appid_map(&library_paths);

    for path in game_paths {
        if let Some(appid) = resolve_steam_app_id(&path_to_appid, path) {
            return Some(appid);
        }
    }

    None
}
