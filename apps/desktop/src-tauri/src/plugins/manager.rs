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
                    match Plugin::load_from_dir(&path, app_handle.clone(), logs.clone()) {
                        Ok(plugin) => {
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
