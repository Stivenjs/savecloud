//! Integración con el manifiesto de Ludusavi para detectar rutas de guardados
//! de juegos (Steam y otros). Fuente: https://github.com/mtkennerly/ludusavi-manifest
//! Licencia del manifiesto: MIT (mtkennerly).

use serde_yaml::Value;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/refs/heads/master/data/manifest.yaml";

/// Entrada del manifiesto para un juego: nombre y rutas de guardado (templates).
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

/// Comprueba si un bloque "when" aplica a Windows + Steam (o solo Windows para cracks).
#[allow(dead_code)]
fn when_applies_windows(when: &Value) -> bool {
    let arr = match when.as_sequence() {
        Some(a) => a,
        None => return true,
    };
    for cond in arr {
        let map = match cond.as_mapping() {
            Some(m) => m,
            None => continue,
        };
        let os = map
            .get(&Value::String("os".into()))
            .and_then(|v| v.as_str())
            .map(str::to_lowercase);
        let store = map
            .get(&Value::String("store".into()))
            .and_then(|v| v.as_str())
            .map(str::to_lowercase);
        // Aceptar: os windows (o sin os) y store steam (o sin store para genérico)
        let ok_os = os.as_deref().map_or(true, |o| o == "windows");
        let ok_store = store.as_deref().map_or(true, |s| s == "steam");
        if ok_os && ok_store {
            return true;
        }
    }
    false
}

/// Comprueba si en el bloque "when" hay alguna condición que aplique a Windows.
fn when_has_windows(when: &Value) -> bool {
    let arr = match when.as_sequence() {
        Some(a) => a,
        None => return true,
    };
    for cond in arr {
        let map = match cond.as_mapping() {
            Some(m) => m,
            None => continue,
        };
        let os = map
            .get(&Value::String("os".into()))
            .and_then(|v| v.as_str())
            .map(str::to_lowercase);
        if os.as_deref().map_or(true, |o| o == "windows") {
            return true;
        }
    }
    false
}

/// Extrae rutas de "files" que tengan tag "save" y when aplicable a Windows.
fn extract_save_paths_from_files(files: &serde_yaml::Mapping) -> Vec<PathTemplate> {
    let mut out = Vec::new();
    for (path_val, entry_val) in files {
        let path_str = path_val.as_str().map(str::trim).unwrap_or("");
        if path_str.is_empty() {
            continue;
        }
        let entry = match entry_val.as_mapping() {
            Some(m) => m,
            None => continue,
        };
        let tags = entry
            .get(&Value::String("tags".into()))
            .and_then(|v| v.as_sequence());
        let has_save = tags.map_or(false, |t| {
            t.iter()
                .any(|v| v.as_str().map_or(false, |s| s.eq_ignore_ascii_case("save")))
        });
        if !has_save {
            continue;
        }
        let when = entry.get(&Value::String("when".into()));
        if !when_has_windows(when.unwrap_or(&Value::Null)) {
            continue;
        }
        let template = if path_str.starts_with(" /") || path_str.starts_with('/') {
            PathTemplate::RelativeToInstall(path_str.trim_start().to_string())
        } else {
            PathTemplate::Absolute(path_str.to_string())
        };
        out.push(template);
    }
    out
}

/// Extrae steam id (principal) y steamExtra del bloque del juego.
fn extract_steam_ids(game_block: &serde_yaml::Mapping) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(steam) = game_block.get(&Value::String("steam".into())) {
        if let Some(m) = steam.as_mapping() {
            if let Some(id) = m.get(&Value::String("id".into())) {
                if let Some(s) = id.as_str().filter(|s| !s.is_empty()) {
                    ids.push(s.to_string());
                } else if let Some(n) = id.as_u64() {
                    ids.push(n.to_string());
                }
            }
        }
    }
    if let Some(extra) = game_block.get(&Value::String("steamExtra".into())) {
        if let Some(arr) = extra.as_sequence() {
            for v in arr {
                if let Some(s) = v.as_str().filter(|s| !s.is_empty()) {
                    ids.push(s.to_string());
                } else if let Some(n) = v.as_u64() {
                    ids.push(n.to_string());
                }
            }
        }
    }
    ids
}

/// Parsea el YAML del manifiesto y construye el índice por Steam App ID.
fn parse_manifest_yaml(content: &str) -> Result<ManifestIndex, String> {
    let root: Value = serde_yaml::from_str(content).map_err(|e| e.to_string())?;
    let games = root
        .as_mapping()
        .ok_or_else(|| "Manifest root is not a map".to_string())?;

    let mut index = ManifestIndex::new();
    for (name_val, game_val) in games {
        let game_name = name_val.as_str().unwrap_or("").trim().to_string();
        if game_name.is_empty() {
            continue;
        }
        let game_block = match game_val.as_mapping() {
            Some(m) => m,
            None => continue,
        };

        let steam_ids = extract_steam_ids(game_block);
        if steam_ids.is_empty() {
            continue;
        }

        let mut save_paths = Vec::new();

        if let Some(files) = game_block.get(&Value::String("files".into())) {
            if let Some(files_map) = files.as_mapping() {
                save_paths.extend(extract_save_paths_from_files(files_map));
            }
        }

        let registry_path = game_block
            .get(&Value::String("registry".into()))
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let entry = GameManifestEntry {
            name: game_name,
            save_paths,
            registry_path,
        };

        for id in steam_ids {
            index.entry(id).or_insert(entry.clone());
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
        let mut result = s.to_string();
        for (var, val) in std::env::vars() {
            let placeholder = format!("%{}%", var);
            if result.contains(&placeholder) {
                result = result.replace(&placeholder, &val);
            }
        }
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
    if entry.registry_path.is_some() {
        // Por ahora no añadimos rutas de registro como carpetas; Ludusavi las trata aparte.
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
        assert!(r.contains("saves"));
        std::env::remove_var("TEST_VAR");
    }
}
