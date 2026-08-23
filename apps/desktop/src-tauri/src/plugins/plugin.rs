//! Módulo para gestionar una instancia de plugin individual.
//!
//! Contiene las funciones para:
//! - Cargar el plugin desde un directorio (`load_from_dir`).
//! - Ejecutar los hooks de ciclo de vida (`on_init`, `on_game_start`, `on_game_exit`, `on_save_detected`).
//! - Ejecutar los hooks de pipeline de datos (`on_pre_upload`, `on_post_upload`).

use super::api::register_savecloud_api;
use super::manifest::PluginManifest;
use crate::plugins::log_buffer::AppLogs;
use crate::sqlite::AppDb;
use mlua::{Function, Lua, Result, Value};
use rusqlite::params;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub struct Plugin {
    pub id: String,
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

        let id = manifest.id.clone();
        let name = dir_path.file_name().unwrap().to_string_lossy().to_string();

        if let Some(db) = app_handle.try_state::<AppDb>() {
            let id_clone = id.clone();
            let name_clone = name.clone();
            let _ = db.with_conn(|conn| {
                if id_clone != name_clone {
                    conn.execute(
                        "UPDATE OR IGNORE plugin_storage SET plugin_id = ?1 WHERE plugin_id = ?2",
                        params![id_clone, name_clone],
                    )?;
                    conn.execute(
                        "DELETE FROM plugin_storage WHERE plugin_id = ?2",
                        params![name_clone],
                    )?;
                }
                Ok(())
            });
        }

        register_savecloud_api(&lua, app_handle, logs, id.clone(), name.clone())?;

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
            id,
            name,
            lua: Arc::new(Mutex::new(lua)),
            pre_upload_timeout: Duration::from_millis(manifest.resolved_pre_upload_timeout_ms()),
        })
    }

    pub fn trigger_on_init(&self) -> Result<()> {
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

    pub fn trigger_on_game_start(&self, game_id: &str, game_name: &str) -> Result<()> {
        let lua = self.lua.lock().map_err(|_| {
            mlua::Error::RuntimeError("No se pudo obtener lock de VM del plugin".to_string())
        })?;
        let globals = lua.globals();

        if let Ok(func) = globals.get::<Function>("on_game_start") {
            let game_info = lua.create_table()?;
            game_info.set("id", game_id)?;
            game_info.set("name", game_name)?;
            func.call::<()>(game_info)
                .map_err(|err| mlua::Error::RuntimeError(clean_lua_error(&err)))?;
        }

        Ok(())
    }

    pub fn trigger_on_game_exit(
        &self,
        game_id: &str,
        game_name: &str,
        duration_secs: u64,
    ) -> Result<()> {
        let lua = self.lua.lock().map_err(|_| {
            mlua::Error::RuntimeError("No se pudo obtener lock de VM del plugin".to_string())
        })?;
        let globals = lua.globals();

        if let Ok(func) = globals.get::<Function>("on_game_exit") {
            let game_info = lua.create_table()?;
            game_info.set("id", game_id)?;
            game_info.set("name", game_name)?;

            let session_info = lua.create_table()?;
            session_info.set("duration_secs", duration_secs)?;

            func.call::<()>((game_info, session_info))
                .map_err(|err| mlua::Error::RuntimeError(clean_lua_error(&err)))?;
        }

        Ok(())
    }

    pub fn trigger_on_save_detected(&self, game_id: &str, save_path: &str) -> Result<()> {
        let lua = self.lua.lock().map_err(|_| {
            mlua::Error::RuntimeError("No se pudo obtener lock de VM del plugin".to_string())
        })?;
        let globals = lua.globals();

        if let Ok(func) = globals.get::<Function>("on_save_detected") {
            let game_info = lua.create_table()?;
            game_info.set("id", game_id)?;

            func.call::<()>((game_info, save_path))
                .map_err(|err| mlua::Error::RuntimeError(clean_lua_error(&err)))?;
        }

        Ok(())
    }

    pub async fn trigger_on_pre_upload(
        &self,
        data: &[u8],
        game_id: &str,
        filename: &str,
    ) -> Result<Vec<u8>> {
        let lua = self.lua.clone();
        let input = data.to_vec();
        let timeout = self.pre_upload_timeout;
        let gid = game_id.to_string();
        let fname = filename.to_string();

        let result = tokio::time::timeout(
            timeout,
            tauri::async_runtime::spawn_blocking(move || {
                let lua = lua.lock().map_err(|_| {
                    mlua::Error::RuntimeError(
                        "No se pudo obtener lock de VM del plugin".to_string(),
                    )
                })?;
                let globals = lua.globals();

                if let Ok(func) = globals.get::<Function>("on_pre_upload") {
                    let context = lua.create_table()?;
                    context.set("game_id", gid)?;
                    context.set("filename", fname)?;

                    let lua_str = lua.create_string(&input)?;
                    let res: Value = func
                        .call((lua_str, context))
                        .map_err(|err| mlua::Error::RuntimeError(clean_lua_error(&err)))?;

                    return match res {
                        Value::String(s) => Ok(s.as_bytes().to_vec()),
                        _ => Ok(input),
                    };
                }

                Ok(input)
            }),
        )
        .await;

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

    pub fn trigger_on_post_upload(
        &self,
        game_id: &str,
        ok: bool,
        files_count: usize,
        error_count: usize,
    ) -> Result<()> {
        let lua = self.lua.lock().map_err(|_| {
            mlua::Error::RuntimeError("No se pudo obtener lock de VM del plugin".to_string())
        })?;
        let globals = lua.globals();

        if let Ok(func) = globals.get::<Function>("on_post_upload") {
            let summary = lua.create_table()?;
            summary.set("game_id", game_id)?;
            summary.set("ok", ok)?;
            summary.set("files_count", files_count)?;
            summary.set("error_count", error_count)?;

            func.call::<()>(summary)
                .map_err(|err| mlua::Error::RuntimeError(clean_lua_error(&err)))?;
        }

        Ok(())
    }

    pub fn trigger_on_pre_download(&self, game_id: &str) -> Result<()> {
        let lua = self.lua.lock().map_err(|_| {
            mlua::Error::RuntimeError("No se pudo obtener lock de VM del plugin".to_string())
        })?;
        let globals = lua.globals();

        if let Ok(func) = globals.get::<Function>("on_pre_download") {
            let context = lua.create_table()?;
            context.set("game_id", game_id)?;

            func.call::<()>(context)
                .map_err(|err| mlua::Error::RuntimeError(clean_lua_error(&err)))?;
        }

        Ok(())
    }

    pub fn trigger_on_post_download(
        &self,
        game_id: &str,
        ok: bool,
        files_count: usize,
        error_count: usize,
    ) -> Result<()> {
        let lua = self.lua.lock().map_err(|_| {
            mlua::Error::RuntimeError("No se pudo obtener lock de VM del plugin".to_string())
        })?;
        let globals = lua.globals();

        if let Ok(func) = globals.get::<Function>("on_post_download") {
            let summary = lua.create_table()?;
            summary.set("game_id", game_id)?;
            summary.set("ok", ok)?;
            summary.set("files_count", files_count)?;
            summary.set("error_count", error_count)?;

            func.call::<()>(summary)
                .map_err(|err| mlua::Error::RuntimeError(clean_lua_error(&err)))?;
        }

        Ok(())
    }
}
