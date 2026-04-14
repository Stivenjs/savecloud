//! Módulo para registrar la API de SaveCloud en Lua.
//!
//! Contiene las funciones para:
//!
//! - Registrar el módulo de log.
//! - Registrar el módulo de UI.
//! - Registrar el módulo de DB.
//! - Registrar el módulo de HTTP.

use crate::plugins::log_buffer::{AppLogs, LogEntry};
use mlua::{Lua, Result, Table};
use tauri::AppHandle;

pub fn register_savecloud_api(
    lua: &Lua,
    app_handle: AppHandle,
    logs: AppLogs,
    plugin_name: String,
) -> Result<()> {
    let globals = lua.globals();

    let savecloud_table = lua.create_table()?;

    register_log_module(lua, &savecloud_table, app_handle.clone(), logs, plugin_name)?;
    register_ui_module(lua, &savecloud_table, app_handle.clone())?;
    register_db_module(lua, &savecloud_table)?;
    register_http_module(lua, &savecloud_table)?;

    globals.set("savecloud", savecloud_table)?;
    //globals.set("os", mlua::Value::Nil)?;
    //globals.set("io", mlua::Value::Nil)?;

    Ok(())
}

fn register_log_module(
    lua: &Lua,
    parent_table: &Table,
    app_handle: AppHandle,
    logs: AppLogs,
    plugin_name: String,
) -> Result<()> {
    let log_table = lua.create_table()?;

    let logs_info = logs.clone();
    let plugin_name_info = plugin_name.clone();
    let app_handle_info = app_handle.clone();

    let info = lua.create_function(move |_, msg: String| {
        let entry = LogEntry {
            timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
            level: "info".to_string(),
            plugin: plugin_name_info.clone(),
            message: msg.clone(),
        };

        println!("[Plugin INFO][{}]: {}", plugin_name_info, msg);

        let logs = logs_info.clone();
        let entry_clone = entry.clone();
        let handle = app_handle_info.clone();

        tauri::async_runtime::spawn(async move {
            logs.lock().await.push(entry_clone.clone());
            use tauri::Emitter;
            let _ = handle.emit("plugin_log", entry_clone);
        });

        Ok(())
    })?;

    let logs_error = logs.clone();
    let plugin_name_error = plugin_name.clone();
    let app_handle_error = app_handle.clone();

    let error = lua.create_function(move |_, msg: String| {
        let entry = LogEntry {
            timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
            level: "error".to_string(),
            plugin: plugin_name_error.clone(),
            message: msg.clone(),
        };

        eprintln!("[Plugin ERROR][{}]: {}", plugin_name_error, msg);

        let logs = logs_error.clone();
        let entry_clone = entry.clone();
        let handle = app_handle_error.clone();

        tauri::async_runtime::spawn(async move {
            logs.lock().await.push(entry_clone.clone());
            use tauri::Emitter;
            let _ = handle.emit("plugin_log", entry_clone);
        });

        Ok(())
    })?;

    log_table.set("info", info)?;
    log_table.set("error", error)?;
    parent_table.set("log", log_table)?;

    Ok(())
}

fn register_ui_module(lua: &Lua, parent_table: &Table, app_handle: AppHandle) -> Result<()> {
    let ui_table = lua.create_table()?;

    let emit = lua.create_function(move |_, (event, payload): (String, String)| {
        use tauri::Emitter;
        let _ = app_handle.emit(&event, payload);
        Ok(())
    })?;

    ui_table.set("emit", emit)?;
    parent_table.set("ui", ui_table)?;

    Ok(())
}

fn register_db_module(lua: &Lua, parent_table: &Table) -> Result<()> {
    let db_table = lua.create_table()?;

    let log_operation =
        lua.create_function(|_, (plugin, action, details): (String, String, String)| {
            println!(
                "[DB Mock] Insertando operacion -> Plugin: {}, Accion: {}, Detalles: {}",
                plugin, action, details
            );
            Ok(())
        })?;

    db_table.set("log_operation", log_operation)?;
    parent_table.set("db", db_table)?;

    Ok(())
}

// Todas las funciones devuelven una tabla Lua con la forma:
//
//   { ok = true,  status = 200, body = "..." }
//   { ok = false, status = 0,   body = "",  error = "mensaje" }
//
// Esto permite que el plugin maneje errores sin que un fallo de
// red rompa el plugin completo.
//
// Headers opcionales se pasan como tabla Lua:
//   { ["Content-Type"] = "application/json", ["Authorization"] = "Bearer ..." }

fn build_response_table(lua: &Lua, status: u16, body: String) -> Result<Table> {
    let t = lua.create_table()?;
    t.set("ok", status >= 200 && status < 300)?;
    t.set("status", status)?;
    t.set("body", body)?;
    Ok(t)
}

fn build_error_table(lua: &Lua, mensaje: String) -> Result<Table> {
    let t = lua.create_table()?;
    t.set("ok", false)?;
    t.set("status", 0u16)?;
    t.set("body", "")?;
    t.set("error", mensaje)?;
    Ok(t)
}

fn headers_from_lua(tabla: Option<Table>) -> reqwest::header::HeaderMap {
    let mut map = reqwest::header::HeaderMap::new();

    if let Some(t) = tabla {
        for pair in t.pairs::<String, String>() {
            if let Ok((k, v)) = pair {
                if let (Ok(name), Ok(value)) = (
                    reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                    reqwest::header::HeaderValue::from_str(&v),
                ) {
                    map.insert(name, value);
                }
            }
        }
    }

    map
}

fn register_http_module(lua: &Lua, parent_table: &Table) -> Result<()> {
    let http_table = lua.create_table()?;

    // savecloud.http.get(url, headers?)
    // Realiza una petición GET. Headers es opcional.
    //
    // Ejemplo:
    //   local res = savecloud.http.get("https://api.example.com/status")
    //   local res = savecloud.http.get("https://api.example.com/me", {
    //     ["Authorization"] = "Bearer token123"
    //   })
    let get = lua.create_function(|lua, (url, headers): (String, Option<Table>)| {
        let client = reqwest::blocking::Client::new();

        let result = client.get(&url).headers(headers_from_lua(headers)).send();

        match result {
            Ok(res) => {
                let status = res.status().as_u16();
                let body = res.text().unwrap_or_default();
                Ok(build_response_table(lua, status, body)?)
            }
            Err(e) => Ok(build_error_table(lua, e.to_string())?),
        }
    })?;

    // savecloud.http.post(url, body, headers?)
    // Realiza una petición POST con body string.
    //
    // Ejemplo:
    //   local res = savecloud.http.post(
    //     "https://api.example.com/data",
    //     '{"key":"value"}',
    //     { ["Content-Type"] = "application/json" }
    //   )
    let post = lua.create_function(
        |lua, (url, body, headers): (String, String, Option<Table>)| {
            let client = reqwest::blocking::Client::new();

            let result = client
                .post(&url)
                .headers(headers_from_lua(headers))
                .body(body)
                .send();

            match result {
                Ok(res) => {
                    let status = res.status().as_u16();
                    let body = res.text().unwrap_or_default();
                    Ok(build_response_table(lua, status, body)?)
                }
                Err(e) => Ok(build_error_table(lua, e.to_string())?),
            }
        },
    )?;

    // savecloud.http.put(url, body, headers?)
    // Realiza una petición PUT con body string.
    //
    // Ejemplo:
    //   local res = savecloud.http.put(
    //     "https://api.example.com/resource/1",
    //     '{"name":"nuevo"}',
    //     { ["Content-Type"] = "application/json" }
    //   )
    let put = lua.create_function(
        |lua, (url, body, headers): (String, String, Option<Table>)| {
            let client = reqwest::blocking::Client::new();

            let result = client
                .put(&url)
                .headers(headers_from_lua(headers))
                .body(body)
                .send();

            match result {
                Ok(res) => {
                    let status = res.status().as_u16();
                    let body = res.text().unwrap_or_default();
                    Ok(build_response_table(lua, status, body)?)
                }
                Err(e) => Ok(build_error_table(lua, e.to_string())?),
            }
        },
    )?;

    // savecloud.http.delete(url, headers?)
    // Realiza una petición DELETE.
    //
    // Ejemplo:
    //   local res = savecloud.http.delete(
    //     "https://api.example.com/resource/1",
    //     { ["Authorization"] = "Bearer token123" }
    //   )
    let delete = lua.create_function(|lua, (url, headers): (String, Option<Table>)| {
        let client = reqwest::blocking::Client::new();

        let result = client
            .delete(&url)
            .headers(headers_from_lua(headers))
            .send();

        match result {
            Ok(res) => {
                let status = res.status().as_u16();
                let body = res.text().unwrap_or_default();
                Ok(build_response_table(lua, status, body)?)
            }
            Err(e) => Ok(build_error_table(lua, e.to_string())?),
        }
    })?;

    http_table.set("get", get)?;
    http_table.set("post", post)?;
    http_table.set("put", put)?;
    http_table.set("delete", delete)?;
    parent_table.set("http", http_table)?;

    Ok(())
}
