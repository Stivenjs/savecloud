//! Integración con el manifiesto de Ludusavi para detectar rutas de guardados
//! de juegos (Steam y otros). Fuente: https://github.com/mtkennerly/ludusavi-manifest
//! Licencia del manifiesto: MIT (mtkennerly).

use serde::Deserialize;
use std::collections::HashMap;
use std::path::Path;
use tokio::fs;

const MANIFEST_URL: &str =
    "https://raw.githubusercontent.com/mtkennerly/ludusavi-manifest/refs/heads/master/data/manifest.yaml";

/// Entrada del manifiesto para un juego: nombre y rutas de guardado (templates).
#[derive(Clone, Debug)]
pub struct GameManifestEntry {
    pub name: String,
    /// Rutas que contienen los placeholders de Ludusavi (<winAppData>, <base>, etc.)
    pub save_paths: Vec<PathTemplate>,
    /// Ruta de registro Windows (opcional).
    #[allow(dead_code)]
    pub registry_path: Option<String>,
}

#[derive(Clone, Debug)]
pub enum PathTemplate {
    /// Ruta absoluta con placeholders del sistema (ej. <winAppData>/Game/Saves).
    Absolute(String),
    /// Ruta relativa al directorio de instalación (ej. "saves" extraído de "<base>/saves").
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
}

/// Descarga el manifiesto de forma asíncrona y lo guarda en la caché.
async fn ensure_manifest_cached(cache_path: &Path) -> Result<(), String> {
    if cache_path.exists() {
        return Ok(());
    }

    let parent = cache_path
        .parent()
        .ok_or_else(|| "No parent dir for manifest".to_string())?;

    fs::create_dir_all(parent)
        .await
        .map_err(|e| e.to_string())?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(MANIFEST_URL)
        .send()
        .await
        .map_err(|e| format!("Error de red: {}", e))?;

    let body = response
        .bytes()
        .await
        .map_err(|e| format!("Error leyendo bytes: {}", e))?;

    fs::write(cache_path, &body)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Carga el manifiesto desde el directorio de configuración de forma asíncrona.
pub async fn load_manifest_index_async() -> Result<ManifestIndex, String> {
    let cache_dir = crate::config::config_dir()
        .ok_or_else(|| "No se pudo obtener el directorio de config".to_string())?;
    let cache_path = cache_dir.join("ludusavi-manifest.yaml");

    ensure_manifest_cached(&cache_path).await?;

    // La lectura del archivo y el parseo del YAML pueden bloquear un poco,
    // lo delegamos al pool de blocking de Tokio.
    tokio::task::spawn_blocking(move || {
        let content = std::fs::read_to_string(&cache_path).map_err(|e| e.to_string())?;
        parse_manifest_yaml(&content)
    })
    .await
    .map_err(|e| e.to_string())?
}

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

                let template = if path_str.starts_with("<base>") {
                    let rel_path = path_str
                        .strip_prefix("<base>/")
                        .unwrap_or(path_str)
                        .replace("<base>", "");
                    PathTemplate::RelativeToInstall(rel_path)
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

/// Expande los placeholders específicos de Ludusavi a rutas reales del sistema.
fn expand_ludusavi_placeholders(s: &str) -> String {
    let mut result = s.to_string();

    #[cfg(target_os = "windows")]
    {
        if result.contains("<winAppData>") {
            if let Ok(val) = std::env::var("APPDATA") {
                result = result.replace("<winAppData>", &val);
            }
        }
        if result.contains("<winLocalAppData>") {
            if let Ok(val) = std::env::var("LOCALAPPDATA") {
                result = result.replace("<winLocalAppData>", &val);
            }
        }
        if result.contains("<winDocuments>") {
            if let Ok(val) = std::env::var("USERPROFILE") {
                result = result.replace("<winDocuments>", &format!("{}\\Documents", val));
            }
        }
        if result.contains("<winPublic>") {
            if let Ok(val) = std::env::var("PUBLIC") {
                result = result.replace("<winPublic>", &val);
            } else {
                result = result.replace("<winPublic>", "C:\\Users\\Public");
            }
        }
        if result.contains("<home>") {
            if let Ok(val) = std::env::var("USERPROFILE") {
                result = result.replace("<home>", &val);
            }
        }
        if result.contains("<osUserName>") {
            if let Ok(val) = std::env::var("USERNAME") {
                result = result.replace("<osUserName>", &val);
            }
        }

        // Ludusavi usa slashes (/) en el YAML, en Windows necesitamos backslashes (\)
        result = result.replace('/', "\\");
    }

    #[cfg(not(target_os = "windows"))]
    {
        if result.contains("<home>") {
            if let Ok(home) = std::env::var("HOME") {
                result = result.replace("<home>", &home);
            }
        }
        if result.contains("<osUserName>") {
            if let Ok(val) = std::env::var("USER") {
                result = result.replace("<osUserName>", &val);
            }
        }
    }

    // Fallback: si el YAML tiene alguna variable nativa %VAR%
    if result.contains('%') {
        #[cfg(target_os = "windows")]
        {
            let mut temp = String::with_capacity(result.len() + 32);
            let mut remaining = result.as_str();

            while let Some(start) = remaining.find('%') {
                temp.push_str(&remaining[..start]);
                remaining = &remaining[start + 1..];

                if let Some(end) = remaining.find('%') {
                    let var_name = &remaining[..end];
                    if let Ok(val) = std::env::var(var_name) {
                        temp.push_str(&val);
                    } else {
                        temp.push('%');
                        temp.push_str(var_name);
                        temp.push('%');
                    }
                    remaining = &remaining[end + 1..];
                } else {
                    temp.push('%');
                    break;
                }
            }
            temp.push_str(remaining);
            result = temp;
        }
    }

    result
}

/// Resuelve una plantilla de ruta. Si es relativa a la instalación, requiere el `install_dir`.
pub fn resolve_path_template(template: &PathTemplate, install_dir: Option<&str>) -> String {
    match template {
        PathTemplate::Absolute(s) => expand_ludusavi_placeholders(s),
        PathTemplate::RelativeToInstall(rel) => {
            let rel_expanded = expand_ludusavi_placeholders(rel);
            let rel_trim = rel_expanded.trim_start_matches(|c| c == ' ' || c == '\\' || c == '/');

            if let Some(base) = install_dir.filter(|s| !s.is_empty()) {
                let base = base.trim_end_matches(&['/', '\\']);
                format!("{}{}{}", base, std::path::MAIN_SEPARATOR, rel_trim)
            } else {
                // Si la ruta requiere instalación pero no la pasamos, devolvemos vacío para no escanear la raíz
                String::new()
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
