//! Módulo para gestionar un plugin.
//!
//! Contiene las funciones para:
//!
//! - Cargar el plugin desde un directorio.
//! - Ejecutar el hook de inicialización.
//! - Ejecutar el hook de pre-subida (Pipeline).

use super::api::register_savecloud_api;
use super::manifest::PluginManifest;
use crate::plugins::log_buffer::AppLogs;
use mlua::{Function, Lua, Result};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;

pub struct Plugin {
    pub name: String,
    lua: Arc<Mutex<Lua>>,
    pre_upload_timeout: Duration,
}

pub fn clean_lua_error(err: &mlua::Error) -> String {
    match err {
        mlua::Error::RuntimeError(msg) => msg.clone(),
        mlua::Error::CallbackError { cause, .. } => clean_lua_error(cause),
        otro => otro.to_string(),
    }
}

impl Plugin {
    pub fn load_from_dir(
        dir_path: &Path,
        app_handle: AppHandle,
        logs: AppLogs,
        manifest: &PluginManifest,
    ) -> Result<Self> {
        let lua = Lua::new();

        let name = dir_path.file_name().unwrap().to_string_lossy().to_string();

        register_savecloud_api(&lua, app_handle, logs, name.clone())?;

        let folder_str = dir_path.to_string_lossy().replace('\\', "/");
        let setup_script = format!(
            "package.path = package.path .. ';{}/?.lua;{}/?/init.lua'",
            folder_str, folder_str
        );
        lua.load(&setup_script).exec()?;

        let init_path = dir_path.join("init.lua");
        if !init_path.exists() {
            return Err(mlua::Error::RuntimeError(format!(
                "init.lua no encontrado en {}",
                name
            )));
        }

        let script = std::fs::read_to_string(&init_path)?;
        lua.load(&script).exec()?;

        Ok(Self {
            name,
            lua: Arc::new(Mutex::new(lua)),
            pre_upload_timeout: Duration::from_millis(manifest.resolved_pre_upload_timeout_ms()),
        })
    }

    pub fn trigger_on_init(&self) -> Result<()> {
        // Lectura explícita para mantener visible la configuración efectiva del hook.
        let _pre_upload_timeout_ms = self.pre_upload_timeout.as_millis();
        let lua = self.lua.lock().map_err(|_| {
            mlua::Error::RuntimeError("No se pudo obtener lock de VM del plugin".to_string())
        })?;
        let globals = lua.globals();

        if let Ok(func) = globals.get::<Function>("on_init") {
            func.call::<()>(())
                .map_err(|err| mlua::Error::RuntimeError(clean_lua_error(&err)))?;
        }

        Ok(())
    }

    pub fn _on_pre_upload(&self, data: &[u8]) -> Result<Vec<u8>> {
        let lua = self.lua.clone();
        let input = data.to_vec();
        let timeout = self.pre_upload_timeout;

        let result = tauri::async_runtime::block_on(async move {
            tokio::time::timeout(
                timeout,
                tauri::async_runtime::spawn_blocking(move || {
                    let lua = lua.lock().map_err(|_| {
                        mlua::Error::RuntimeError(
                            "No se pudo obtener lock de VM del plugin".to_string(),
                        )
                    })?;
                    let globals = lua.globals();

                    if let Ok(func) = globals.get::<Function>("on_pre_upload") {
                        let modified_data: Vec<u8> = func
                            .call::<Vec<u8>>(input)
                            .map_err(|err| mlua::Error::RuntimeError(clean_lua_error(&err)))?;
                        return Ok(modified_data);
                    }

                    Ok(input)
                }),
            )
            .await
        });

        match result {
            Ok(Ok(inner)) => inner,
            Ok(Err(join_err)) => Err(mlua::Error::RuntimeError(format!(
                "on_pre_upload task join error: {join_err}"
            ))),
            Err(_) => Err(mlua::Error::RuntimeError(format!(
                "on_pre_upload timeout after {}ms",
                timeout.as_millis()
            ))),
        }
    }
}
