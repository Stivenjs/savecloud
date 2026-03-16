//! Rutas de guardados.
#![allow(dead_code)]
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize, Debug)]

pub struct ConfigPaths {
    pub windows: WindowsPaths,
    pub unix: UnixPaths,
}

#[derive(Deserialize, Debug)]
pub struct WindowsPaths {
    pub default_steam_path: String,
    pub base_scan_templates: Vec<PathEntry>,
    pub crack_save_locations: Vec<PathEntry>,
}

#[derive(Deserialize, Debug)]
pub struct UnixPaths {
    pub base_scan_templates: Vec<PathEntry>,
}

#[derive(Deserialize, Debug)]
pub struct PathEntry {
    pub path: String,
    pub label: String,
}

pub fn get_config() -> &'static ConfigPaths {
    static CONFIG: OnceLock<ConfigPaths> = OnceLock::new();

    CONFIG.get_or_init(|| {
        let json_data = include_str!("data/paths.json");
        serde_json::from_str(json_data).expect("Error al parsear paths.json")
    })
}

#[cfg(target_os = "windows")]
pub fn default_steam_path() -> &'static str {
    &get_config().windows.default_steam_path
}

#[cfg(target_os = "windows")]
pub fn base_scan_templates() -> &'static [PathEntry] {
    &get_config().windows.base_scan_templates
}

#[cfg(not(target_os = "windows"))]
pub fn base_scan_templates() -> &'static [PathEntry] {
    &get_config().unix.base_scan_templates
}

#[cfg(target_os = "windows")]
pub fn crack_save_locations() -> &'static [PathEntry] {
    &get_config().windows.crack_save_locations
}
