//! Integración con el manifiesto de Ludusavi para detectar rutas de guardados
//! de juegos (Steam y otros). Fuente: https://github.com/mtkennerly/ludusavi-manifest
//! Licencia del manifiesto: MIT (mtkennerly).

use serde::Deserialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/refs/heads/master/data/manifest.yaml";

/// Entrada del manifiesto para un juego: nombre y rutas de guardado (templates).
#[allow(dead_code)]
#[derive(Clone, Debug)]
pub struct GameManifestEntry {
    pub name: String,
    /// Rutas que pueden contener %APPDATA%, %USERPROFILE%, etc. O relativas al install dir (prefijo " /").
    pub save_paths: Vec<PathTemplate>,
    /// Ruta de registro Windows (opcional).
    pub registry_path: Option<String>,
}

#[derive(Clone, Debug)]
pub enum PathTemplate {
    /// Ruta absoluta o con variables de entorno (ej. %APPDATA%\Game\Saves).
    Absolute(String),
    /// Ruta relativa al directorio de instalación (ej. " /saves").
    RelativeToInstall(String),
}

/// Índice: Steam App ID (string) -> entrada del manifiesto.
pub type ManifestIndex = HashMap<String, GameManifestEntry>;

#[derive(Deserialize, Debug)]
struct ManifestGame {
    files: Option<HashMap<String, FileEntry>>,
    steam: Option<SteamEntry>,
    #[serde(rename = "steamExtra")]
    steam_extra: Option<Vec<SteamId>>,
    registry: Option<String>,
}

#[derive(Deserialize, Debug)]
struct FileEntry {
    tags: Option<Vec<String>>,
    when: Option<Vec<WhenCondition>>,
}

#[derive(Deserialize, Debug)]
struct SteamEntry {
    id: Option<SteamId>,
}

#[derive(Deserialize, Debug)]
#[serde(untagged)]
enum SteamId {
    Num(u64),
    Str(String),
}

impl SteamId {
    fn into_string(self) -> String {
        match self {
            SteamId::Num(n) => n.to_string(),
            SteamId::Str(s) => s,
        }
    }
}

#[derive(Deserialize, Debug)]
struct WhenCondition {
    os: Option<String>,
    // store: Option<String>, // Por si necesito saber el launcher de donde es el juego
}

/// Descarga el manifiesto y lo guarda en cache_dir/manifest.yaml. Devuelve la ruta del archivo.
fn ensure_manifest_cached(cache_path: &Path) -> Result<(), String> {
    if cache_path.exists() {
        return Ok(());
    }
    let parent = cache_path
        .parent()
        .ok_or_else(|| "No parent dir for manifest".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let body = client
        .get(MANIFEST_URL)
        .send()
        .map_err(|e| e.to_string())?
        .bytes()
        .map_err(|e| e.to_string())?;

    fs::write(cache_path, &body).map_err(|e| e.to_string())?;
    Ok(())
}

/// Comprueba si en el bloque "when" hay alguna condición que aplique a Windows.
fn when_has_windows(when_list: &Option<Vec<WhenCondition>>) -> bool {
    let conditions = match when_list {
        Some(c) => c,
        None => return true,
    };

    if conditions.is_empty() {
        return true;
    }

    conditions.iter().any(|cond| {
        cond.os
            .as_deref()
            .map_or(true, |o| o.eq_ignore_ascii_case("windows"))
    })
}

/// Parsea el YAML del manifiesto usando deserialización tipada y construye el índice.
fn parse_manifest_yaml(content: &str) -> Result<ManifestIndex, String> {
    let root: HashMap<String, ManifestGame> =
        serde_yaml::from_str(content).map_err(|e| format!("Failed to parse YAML: {}", e))?;

    let mut index = ManifestIndex::with_capacity(root.len());

    for (game_name, game_data) in root {
        if game_name.trim().is_empty() {
            continue;
        }

        let mut steam_ids = Vec::new();
        if let Some(steam) = game_data.steam.and_then(|s| s.id) {
            let id_str = steam.into_string();
            if !id_str.is_empty() {
                steam_ids.push(id_str);
            }
        }

        if let Some(extra_ids) = game_data.steam_extra {
            for id in extra_ids {
                let id_str = id.into_string();
                if !id_str.is_empty() {
                    steam_ids.push(id_str);
                }
            }
        }

        if steam_ids.is_empty() {
            continue;
        }

        let mut save_paths = Vec::new();
        if let Some(files) = game_data.files {
            for (path_str, entry) in files {
                let path_str = path_str.trim();
                if path_str.is_empty() {
                    continue;
                }

                let has_save = entry.tags.as_ref().map_or(false, |tags| {
                    tags.iter().any(|t| t.eq_ignore_ascii_case("save"))
                });

                if !has_save || !when_has_windows(&entry.when) {
                    continue;
                }

                let template = if path_str.starts_with(" /") || path_str.starts_with('/') {
                    PathTemplate::RelativeToInstall(path_str.trim_start().to_string())
                } else {
                    PathTemplate::Absolute(path_str.to_string())
                };

                save_paths.push(template);
            }
        }

        let entry = GameManifestEntry {
            name: game_name,
            save_paths,
            registry_path: game_data
                .registry
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
        };

        for id in steam_ids {
            index.insert(id, entry.clone());
        }
    }

    Ok(index)
}

/// Carga el manifiesto desde el directorio de configuración (descargando si hace falta).
pub fn load_manifest_index() -> Option<ManifestIndex> {
    let cache_path = crate::config::config_dir()?.join("ludusavi-manifest.yaml");
    ensure_manifest_cached(&cache_path).ok()?;
    let content = fs::read_to_string(&cache_path).ok()?;
    parse_manifest_yaml(&content).ok()
}

/// Expande variables de entorno en una ruta (Windows: %APPDATA%, etc.).
fn expand_env_path(s: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        let mut result = String::with_capacity(s.len() + 32);
        let mut remaining = s;

        while let Some(start) = remaining.find('%') {
            result.push_str(&remaining[..start]);
            remaining = &remaining[start + 1..];

            if let Some(end) = remaining.find('%') {
                let var_name = &remaining[..end];
                if let Ok(val) = std::env::var(var_name) {
                    result.push_str(&val);
                } else {
                    result.push('%');
                    result.push_str(var_name);
                    result.push('%');
                }
                remaining = &remaining[end + 1..];
            } else {
                result.push('%');
                break;
            }
        }
        result.push_str(remaining);
        result
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut result = s.to_string();
        if let Ok(home) = std::env::var("HOME") {
            result = result.replace("~", &home);
        }
        result
    }
}

/// Resuelve una plantilla de ruta con el directorio de instalación opcional.
pub fn resolve_path_template(template: &PathTemplate, install_dir: Option<&str>) -> String {
    match template {
        PathTemplate::Absolute(s) => expand_env_path(s),
        PathTemplate::RelativeToInstall(rel) => {
            let rel_trim = rel.trim_start_matches(|c| c == ' ' || c == '/');
            if let Some(base) = install_dir.filter(|s| !s.is_empty()) {
                let base = base.trim_end_matches(&['/', '\\']);
                format!("{}{}{}", base, std::path::MAIN_SEPARATOR, rel_trim)
            } else {
                expand_env_path(rel_trim)
            }
        }
    }
}

/// Devuelve la entrada del manifiesto para un Steam App ID y opcionalmente el directorio de instalación.
pub fn get_entry_for_steam_app(
    index: &ManifestIndex,
    steam_app_id: &str,
    install_dir: Option<&str>,
) -> Option<(GameManifestEntry, Vec<String>)> {
    let entry = index.get(steam_app_id)?;
    let mut resolved = Vec::new();
    for template in &entry.save_paths {
        let path = resolve_path_template(template, install_dir);
        if !path.is_empty() {
            resolved.push(path);
        }
    }
    Some((entry.clone(), resolved))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_env_path() {
        std::env::set_var("TEST_VAR", "C:\\Test");
        let r = expand_env_path("%TEST_VAR%\\saves");
        assert_eq!(r, "C:\\Test\\saves");
        std::env::remove_var("TEST_VAR");

        let missing = expand_env_path("C:\\Ruta\\%FALSA%\\save");
        assert_eq!(missing, "C:\\Ruta\\%FALSA%\\save");
    }
}
