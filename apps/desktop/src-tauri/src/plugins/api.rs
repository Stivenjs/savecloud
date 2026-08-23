//! Módulo para registrar la API de SaveCloud en Lua.
//!
//! Contiene las funciones para:
//! - Registrar el módulo de logging (`savecloud.log`).
//! - Registrar el módulo de UI y toasts (`savecloud.ui`).
//! - Registrar el módulo de base de datos / auditoría (`savecloud.db`).
//! - Registrar el módulo HTTP (`savecloud.http`).
//! - Registrar el módulo de almacenamiento persistente aislado por plugin (`savecloud.storage`).
//! - Registrar el módulo de notificaciones y overlay (`savecloud.notifications`).
//! - Registrar el módulo de juegos e información de biblioteca (`savecloud.games`).

use crate::config;
use crate::plugins::log_buffer::{AppLogs, LogEntry};
use crate::sqlite::AppDb;
use mlua::{Lua, Result, Table, Value};
use rusqlite::params;
use rusqlite::OptionalExtension;
use tauri::{AppHandle, Manager};

pub fn register_savecloud_api(
    lua: &Lua,
    app_handle: AppHandle,
    logs: AppLogs,
    plugin_id: String,
    plugin_name: String,
) -> Result<()> {
    let globals = lua.globals();

    let savecloud_table = lua.create_table()?;

    register_log_module(
        lua,
        &savecloud_table,
        app_handle.clone(),
        logs,
        plugin_name,
    )?;
    register_ui_module(lua, &savecloud_table, app_handle.clone())?;
    register_db_module(lua, &savecloud_table)?;
    register_http_module(lua, &savecloud_table)?;
    register_storage_module(
        lua,
        &savecloud_table,
        app_handle.clone(),
        plugin_id,
    )?;
    register_notifications_module(lua, &savecloud_table, app_handle.clone())?;
    register_games_module(lua, &savecloud_table, app_handle)?;

    globals.set("savecloud", savecloud_table)?;
    globals.set("os", Value::Nil)?;
    globals.set("io", Value::Nil)?;

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

    let create_log_fn = |level: &'static str| {
        let logs_inner = logs.clone();
        let plugin_name_inner = plugin_name.clone();
        let app_handle_inner = app_handle.clone();

        lua.create_function(move |_, msg: String| {
            let entry = LogEntry {
                timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
                level: level.to_string(),
                plugin: plugin_name_inner.clone(),
                message: msg.clone(),
            };

            if level == "error" {
                eprintln!("[Plugin ERROR][{}]: {}", plugin_name_inner, msg);
            } else if level == "warn" {
                println!("[Plugin WARN][{}]: {}", plugin_name_inner, msg);
            } else {
                println!(
                    "[Plugin {}][{}]: {}",
                    level.to_uppercase(),
                    plugin_name_inner,
                    msg
                );
            }

            let logs = logs_inner.clone();
            let entry_clone = entry.clone();
            let handle = app_handle_inner.clone();

            tauri::async_runtime::spawn(async move {
                logs.lock().await.push(entry_clone.clone());
                use tauri::Emitter;
                let _ = handle.emit("plugin_log", entry_clone);
            });

            Ok(())
        })
    };

    log_table.set("info", create_log_fn("info")?)?;
    log_table.set("warn", create_log_fn("warn")?)?;
    log_table.set("error", create_log_fn("error")?)?;
    log_table.set("debug", create_log_fn("debug")?)?;
    parent_table.set("log", log_table)?;

    Ok(())
}

fn register_ui_module(lua: &Lua, parent_table: &Table, app_handle: AppHandle) -> Result<()> {
    let ui_table = lua.create_table()?;

    let handle_emit = app_handle.clone();
    let emit = lua.create_function(move |_, (event, payload): (String, String)| {
        use tauri::Emitter;
        let _ = handle_emit.emit(&event, payload);
        Ok(())
    })?;

    let handle_toast = app_handle;
    let show_toast =
        lua.create_function(move |_, (message, level): (String, Option<String>)| {
            use tauri::Emitter;
            #[derive(serde::Serialize, Clone)]
            struct ToastPayload {
                message: String,
                level: String,
            }
            let payload = ToastPayload {
                message,
                level: level.unwrap_or_else(|| "info".to_string()),
            };
            let _ = handle_toast.emit("ui_toast", payload);
            Ok(())
        })?;

    ui_table.set("emit", emit)?;
    ui_table.set("show_toast", show_toast)?;
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

fn register_storage_module(
    lua: &Lua,
    parent_table: &Table,
    app_handle: AppHandle,
    plugin_name: String,
) -> Result<()> {
    let storage_table = lua.create_table()?;

    let handle_get = app_handle.clone();
    let p_name_get = plugin_name.clone();
    let get = lua.create_function(move |_, key: String| {
        let Some(db) = handle_get.try_state::<AppDb>() else {
            return Ok(None::<String>);
        };
        let key_clean = key.trim().to_string();
        let res = db.with_conn(|conn| {
            conn.query_row(
                "SELECT value FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
                params![p_name_get, key_clean],
                |row| row.get::<_, String>(0),
            )
            .optional()
        });
        match res {
            Ok(val) => Ok(val),
            Err(e) => {
                eprintln!("[Plugin Storage Error] get key='{}': {}", key, e);
                Ok(None)
            }
        }
    })?;

    let handle_set = app_handle.clone();
    let p_name_set = plugin_name.clone();
    let set = lua.create_function(move |_, (key, value): (String, String)| {
        let Some(db) = handle_set.try_state::<AppDb>() else {
            return Ok(false);
        };
        let key_clean = key.trim().to_string();
        let res = db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?1, ?2, ?3, unixepoch())
                 ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()",
                params![p_name_set, key_clean, value],
            )
        });
        match res {
            Ok(_) => Ok(true),
            Err(e) => {
                eprintln!("[Plugin Storage Error] set key='{}': {}", key, e);
                Ok(false)
            }
        }
    })?;

    let handle_del = app_handle.clone();
    let p_name_del = plugin_name.clone();
    let delete = lua.create_function(move |_, key: String| {
        let Some(db) = handle_del.try_state::<AppDb>() else {
            return Ok(false);
        };
        let key_clean = key.trim().to_string();
        let res = db.with_conn(|conn| {
            let count = conn.execute(
                "DELETE FROM plugin_storage WHERE plugin_id = ?1 AND key = ?2",
                params![p_name_del, key_clean],
            )?;
            Ok(count > 0)
        });
        match res {
            Ok(deleted) => Ok(deleted),
            Err(e) => {
                eprintln!("[Plugin Storage Error] delete key='{}': {}", key, e);
                Ok(false)
            }
        }
    })?;

    let handle_list = app_handle.clone();
    let p_name_list = plugin_name.clone();
    let list_keys = lua.create_function(move |_, ()| {
        let Some(db) = handle_list.try_state::<AppDb>() else {
            return Ok(Vec::<String>::new());
        };
        let res = db.with_conn(|conn| {
            let mut stmt = conn
                .prepare("SELECT key FROM plugin_storage WHERE plugin_id = ?1 ORDER BY key ASC")?;
            let rows = stmt.query_map(params![p_name_list], |row| row.get::<_, String>(0))?;
            let mut keys = Vec::new();
            for r in rows {
                if let Ok(k) = r {
                    keys.push(k);
                }
            }
            Ok(keys)
        });
        match res {
            Ok(keys) => Ok(keys),
            Err(e) => {
                eprintln!("[Plugin Storage Error] list_keys: {}", e);
                Ok(Vec::new())
            }
        }
    })?;

    let handle_clear = app_handle;
    let p_name_clear = plugin_name;
    let clear = lua.create_function(move |_, ()| {
        let Some(db) = handle_clear.try_state::<AppDb>() else {
            return Ok(false);
        };
        let res = db.with_conn(|conn| {
            let count = conn.execute(
                "DELETE FROM plugin_storage WHERE plugin_id = ?1",
                params![p_name_clear],
            )?;
            Ok(count > 0)
        });
        match res {
            Ok(cleared) => Ok(cleared),
            Err(e) => {
                eprintln!("[Plugin Storage Error] clear: {}", e);
                Ok(false)
            }
        }
    })?;

    storage_table.set("get", get)?;
    storage_table.set("set", set)?;
    storage_table.set("delete", delete)?;
    storage_table.set("list_keys", list_keys)?;
    storage_table.set("clear", clear)?;
    parent_table.set("storage", storage_table)?;

    Ok(())
}

fn register_notifications_module(
    lua: &Lua,
    parent_table: &Table,
    app_handle: AppHandle,
) -> Result<()> {
    let notif_table = lua.create_table()?;

    let handle_show = app_handle.clone();
    let show = lua.create_function(move |_, (title, body): (String, String)| {
        use tauri::Emitter;
        #[derive(serde::Serialize, Clone)]
        struct PluginToastPayload {
            title: String,
            body: String,
        }
        let payload = PluginToastPayload {
            title: title.clone(),
            body: body.clone(),
        };
        let _ = handle_show.emit("plugin_notification", payload);

        let handle_overlay = handle_show.clone();
        tauri::async_runtime::spawn(async move {
            let _ =
                crate::overlay::show_overlay_notification(handle_overlay, title, Some(body)).await;
        });

        Ok(())
    })?;

    let handle_overlay = app_handle;
    let show_overlay = lua.create_function(move |_, (title, body): (String, String)| {
        let handle = handle_overlay.clone();
        tauri::async_runtime::spawn(async move {
            let _ = crate::overlay::show_overlay_notification(handle, title, Some(body)).await;
        });
        Ok(())
    })?;

    notif_table.set("show", show)?;
    notif_table.set("show_overlay", show_overlay)?;
    parent_table.set("notifications", notif_table)?;

    Ok(())
}

fn register_games_module(lua: &Lua, parent_table: &Table, _app_handle: AppHandle) -> Result<()> {
    let games_table = lua.create_table()?;

    let get_all = lua.create_function(|lua, ()| {
        let cfg = config::load_config();
        let list = lua.create_table()?;

        for (idx, game) in cfg.games.iter().enumerate() {
            let item = lua.create_table()?;
            item.set("id", game.id.clone())?;
            item.set("name", game.id.clone())?;
            item.set("paths", game.paths.clone())?;
            item.set("steam_app_id", game.steam_app_id.clone())?;
            item.set("image_url", game.image_url.clone())?;
            item.set("playtime_seconds", game.playtime_seconds)?;
            let is_running = crate::system::process_check::is_game_running(&game.id, &game.paths);
            item.set("is_running", is_running)?;

            list.set(idx + 1, item)?;
        }

        Ok(list)
    })?;

    let get = lua.create_function(|lua, game_id: String| {
        let cfg = config::load_config();
        if let Some(game) = cfg
            .games
            .iter()
            .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        {
            let item = lua.create_table()?;
            item.set("id", game.id.clone())?;
            item.set("name", game.id.clone())?;
            item.set("paths", game.paths.clone())?;
            item.set("steam_app_id", game.steam_app_id.clone())?;
            item.set("image_url", game.image_url.clone())?;
            item.set("playtime_seconds", game.playtime_seconds)?;
            let is_running = crate::system::process_check::is_game_running(&game.id, &game.paths);
            item.set("is_running", is_running)?;
            Ok(Some(item))
        } else {
            Ok(None)
        }
    })?;

    let is_running = lua.create_function(|_, game_id: String| {
        let cfg = config::load_config();
        if let Some(game) = cfg
            .games
            .iter()
            .find(|g| g.id.eq_ignore_ascii_case(&game_id))
        {
            Ok(crate::system::process_check::is_game_running(
                &game.id,
                &game.paths,
            ))
        } else {
            Ok(false)
        }
    })?;

    games_table.set("get_all", get_all)?;
    games_table.set("get", get)?;
    games_table.set("is_running", is_running)?;
    parent_table.set("games", games_table)?;

    Ok(())
}

fn build_response_table(lua: &Lua, status: u16, body: String) -> Result<Table> {
    let t = lua.create_table()?;
    t.set("ok", (200..300).contains(&status))?;
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
        for (k, v) in t.pairs::<String, String>().flatten() {
            if let (Ok(name), Ok(value)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(&v),
            ) {
                map.insert(name, value);
            }
        }
    }

    map
}

fn register_http_module(lua: &Lua, parent_table: &Table) -> Result<()> {
    let http_table = lua.create_table()?;

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
