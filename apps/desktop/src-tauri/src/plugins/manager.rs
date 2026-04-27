//! Módulo para gestionar los plugins.
//!
//! Contiene las funciones para:
//!
//! - Cargar todos los plugins.
//! - Registrar el plugin.
//! - Ejecutar el hook de inicialización.
//! - Ejecutar el hook de pre-subida (Pipeline).

use super::plugin::{clean_lua_error, Plugin};
use crate::plugins::log_buffer::AppLogs;
use crate::plugins::manifest::load_manifest_from_dir;
use std::path::PathBuf;
use tauri::AppHandle;

pub struct PluginManager {
    pub plugins: Vec<Plugin>,
}

impl PluginManager {
    pub fn new() -> Self {
        Self {
            plugins: Vec::new(),
        }
    }

    pub fn _plugin_count(&self) -> usize {
        self.plugins.len()
    }

    pub fn load_all(&mut self, plugins_dir: PathBuf, app_handle: AppHandle, logs: AppLogs) {
        if let Ok(entries) = std::fs::read_dir(plugins_dir) {
            for entry in entries.flatten() {
                let path = entry.path();

                if path.is_dir() {
                    let manifest = match load_manifest_from_dir(&path) {
                        Ok(manifest) => manifest,
                        Err(e) => {
                            eprintln!("Omitiendo carpeta {:?}: {}", path.file_name().unwrap(), e);
                            continue;
                        }
                    };

                    if !manifest.enabled {
                        eprintln!(
                            "Omitiendo plugin '{}' id={} version={} (plugin_disabled)",
                            manifest.name, manifest.id, manifest.version
                        );
                        continue;
                    }

                    if !manifest.is_api_version_compatible() {
                        eprintln!(
                            "Omitiendo plugin '{}' id={} version={} (api_version_mismatch plugin={} core={})",
                            manifest.name,
                            manifest.id,
                            manifest.version,
                            manifest.api_version,
                            crate::plugins::SUPPORTED_PLUGIN_API_VERSION
                        );
                        continue;
                    }

                    match Plugin::load_from_dir(&path, app_handle.clone(), logs.clone(), &manifest)
                    {
                        Ok(plugin) => {
                            println!(
                                "Plugin cargado: name='{}' id='{}' version='{}' api_version={}",
                                manifest.name, manifest.id, manifest.version, manifest.api_version
                            );
                            if let Err(e) = plugin.trigger_on_init() {
                                eprintln!(
                                    "Error en on_init de '{}': {}",
                                    plugin.name,
                                    clean_lua_error(&e)
                                );
                            }

                            self.plugins.push(plugin);
                        }
                        Err(e) => {
                            eprintln!(
                                "Omitiendo carpeta {:?}: {}",
                                path.file_name().unwrap(),
                                clean_lua_error(&e)
                            );
                        }
                    }
                }
            }
        }
    }

    pub fn _execute_pre_upload(&self, mut data: Vec<u8>) -> Vec<u8> {
        for plugin in &self.plugins {
            match plugin._on_pre_upload(&data) {
                Ok(modified_data) => {
                    data = modified_data;
                }
                Err(e) => {
                    eprintln!(
                        "[Plugin Error] '{}' falló en on_pre_upload: {}",
                        plugin.name,
                        clean_lua_error(&e)
                    );
                }
            }
        }
        data
    }
}

#[cfg(test)]
mod tests {
    use crate::plugins::{
        manifest::load_manifest_from_dir, DEFAULT_PRE_UPLOAD_TIMEOUT_MS, MAX_PRE_UPLOAD_TIMEOUT_MS,
        MIN_PRE_UPLOAD_TIMEOUT_MS,
    };

    #[test]
    fn strict_mode_requires_manifest_file() {
        let dir = tempfile::tempdir().expect("tempdir");
        let nested = dir.path().join("example_plugin");
        std::fs::create_dir_all(&nested).expect("create plugin dir");

        let err = load_manifest_from_dir(&nested).expect_err("manifest should be required");
        assert!(err.contains("manifest_missing"));
    }

    #[test]
    fn manifest_invalid_json_is_rejected() {
        let dir = tempfile::tempdir().expect("tempdir");
        let nested = dir.path().join("example_plugin");
        std::fs::create_dir_all(&nested).expect("create plugin dir");
        std::fs::write(nested.join("plugin.json"), "{not valid json").expect("write manifest");

        let err = load_manifest_from_dir(&nested).expect_err("manifest must be valid json");
        assert!(err.contains("manifest_invalid"));
    }

    #[test]
    fn manifest_timeout_default_and_clamp_are_applied() {
        let dir = tempfile::tempdir().expect("tempdir");
        let nested = dir.path().join("example_plugin");
        std::fs::create_dir_all(&nested).expect("create plugin dir");

        std::fs::write(
            nested.join("plugin.json"),
            r#"{
              "id":"example.plugin",
              "name":"Example",
              "version":"1.0.0",
              "api_version":1,
              "enabled":true,
              "hooks":{"on_pre_upload_timeout_ms":999999}
            }"#,
        )
        .expect("write manifest");

        let manifest = load_manifest_from_dir(&nested).expect("manifest parse");
        assert_eq!(
            manifest.resolved_pre_upload_timeout_ms(),
            MAX_PRE_UPLOAD_TIMEOUT_MS
        );

        std::fs::write(
            nested.join("plugin.json"),
            r#"{
              "id":"example.plugin",
              "name":"Example",
              "version":"1.0.0",
              "api_version":1,
              "enabled":true
            }"#,
        )
        .expect("write manifest");
        let manifest_default = load_manifest_from_dir(&nested).expect("manifest parse default");
        assert_eq!(
            manifest_default.resolved_pre_upload_timeout_ms(),
            DEFAULT_PRE_UPLOAD_TIMEOUT_MS
        );

        std::fs::write(
            nested.join("plugin.json"),
            r#"{
              "id":"example.plugin",
              "name":"Example",
              "version":"1.0.0",
              "api_version":1,
              "enabled":true,
              "hooks":{"on_pre_upload_timeout_ms":1}
            }"#,
        )
        .expect("write manifest");
        let manifest_min = load_manifest_from_dir(&nested).expect("manifest parse min");
        assert_eq!(
            manifest_min.resolved_pre_upload_timeout_ms(),
            MIN_PRE_UPLOAD_TIMEOUT_MS
        );
    }
}
