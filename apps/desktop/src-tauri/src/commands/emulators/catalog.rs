use serde::Deserialize;
use std::collections::HashMap;
use std::sync::LazyLock;

const CATALOG_JSON: &str = include_str!("../../../../catalog/emulators.json");

static CATALOG: LazyLock<Result<Vec<EmulatorMetadata>, String>> = LazyLock::new(|| {
    serde_json::from_str(CATALOG_JSON)
        .map_err(|error| format!("Catálogo de emuladores inválido: {error}"))
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorMetadata {
    pub id: String,
    pub name: String,
    pub console: String,
    #[serde(default)]
    pub save_sync_supported: bool,
    #[serde(default)]
    pub managed_install: bool,
    #[serde(default)]
    pub executable_names: Vec<String>,
    #[serde(default)]
    pub executable_search_paths: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub save_paths: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub portable_save_path: Option<String>,
    #[serde(default)]
    pub launch_rules: Vec<LaunchRule>,
}

#[derive(Debug, Deserialize)]
pub struct LaunchRule {
    pub extensions: Vec<String>,
    pub arguments: Vec<String>,
}

/// Devuelve el catálogo compartido por la UI y el backend nativo.
pub fn all() -> Result<&'static [EmulatorMetadata], String> {
    CATALOG.as_ref().map(Vec::as_slice).map_err(Clone::clone)
}

/// Busca la metadata de un emulador por su identificador sin distinguir mayúsculas.
pub fn find(id: &str) -> Result<Option<&'static EmulatorMetadata>, String> {
    Ok(all()?
        .iter()
        .find(|emulator| emulator.id.eq_ignore_ascii_case(id)))
}

/// Devuelve la clave de plataforma que utiliza la metadata del catálogo.
pub fn platform_key() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// Expande rutas con sintaxis portable `%VARIABLE%`, `$HOME` o `~`.
pub fn expand_path(template: &str) -> String {
    let mut expanded = template.to_string();
    if expanded.starts_with('~') {
        if let Some(home) = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")) {
            expanded = expanded.replacen('~', &home.to_string_lossy(), 1);
        }
    }
    for (key, value) in std::env::vars() {
        expanded = expanded.replace(&format!("%{key}%"), &value);
        expanded = expanded.replace(&format!("${key}"), &value);
    }
    expanded
}

/// Sustituye `{file}` por la ruta del juego en los argumentos de lanzamiento.
pub fn launch_arguments(arguments: &[String], game_path: &str) -> Vec<String> {
    arguments
        .iter()
        .map(|argument| argument.replace("{file}", game_path))
        .collect()
}
