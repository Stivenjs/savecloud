//! Comandos IPC para gestión e inspección del sistema de plugins.

use crate::plugins::log_buffer::AppLogs;
use crate::plugins::manifest::load_manifest_from_dir;
use crate::plugins::AppPluginManager;
use crate::sqlite::AppDb;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub author: Option<String>,
    pub enabled: bool,
    pub api_version: u32,
    pub folder_name: String,
    pub folder_path: String,
    pub pre_upload_timeout_ms: u64,
    pub loaded: bool,
    pub error: Option<String>,
    pub storage_keys_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginStorageEntry {
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

fn resolve_plugins_dir() -> PathBuf {
    crate::config::paths::plugins_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default().join("plugins"))
}

fn count_plugin_storage_keys(db_opt: Option<&AppDb>, plugin_id: &str) -> usize {
    let Some(db) = db_opt else { return 0 };
    db.with_conn(|conn| {
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM plugin_storage WHERE plugin_id = ?1")?;
        let count: i64 = stmt.query_row(params![plugin_id], |r| r.get(0))?;
        Ok(count as usize)
    })
    .unwrap_or(0)
}

/// Obtiene la lista completa de plugins instalados en la carpeta de plugins.
#[tauri::command]
pub async fn get_installed_plugins(app_handle: AppHandle) -> Result<Vec<PluginInfo>, String> {
    let plugins_dir = resolve_plugins_dir();
    let db = app_handle.try_state::<AppDb>();
    let db_ref = db.as_deref();

    let pm_opt = app_handle.try_state::<AppPluginManager>();
    let loaded_plugins: Vec<(String, String)> = if let Some(pm) = pm_opt {
        let manager = pm.lock().await;
        manager
            .plugins
            .iter()
            .map(|p| (p.id.clone(), p.name.clone()))
            .collect()
    } else {
        Vec::new()
    };

    let mut list = Vec::new();

    let entries = std::fs::read_dir(&plugins_dir).map_err(|e| {
        format!(
            "No se pudo leer la carpeta de plugins en {:?}: {}",
            plugins_dir, e
        )
    })?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let folder_name = path
            .file_name()
            .map(|f| f.to_string_lossy().to_string())
            .unwrap_or_default();
        let folder_path = path.to_string_lossy().to_string();

        match load_manifest_from_dir(&path) {
            Ok(manifest) => {
                let is_loaded = loaded_plugins.iter().any(|(id, _)| id == &manifest.id);
                let keys_count = count_plugin_storage_keys(db_ref, &manifest.id);
                let timeout_ms = manifest.resolved_pre_upload_timeout_ms();

                list.push(PluginInfo {
                    id: manifest.id,
                    name: manifest.name,
                    version: manifest.version,
                    description: manifest.description,
                    author: manifest.author,
                    enabled: manifest.enabled,
                    api_version: manifest.api_version,
                    folder_name,
                    folder_path,
                    pre_upload_timeout_ms: timeout_ms,
                    loaded: is_loaded,
                    error: None,
                    storage_keys_count: keys_count,
                });
            }
            Err(e) => {
                let id_fallback = folder_name.clone();
                let keys_count = count_plugin_storage_keys(db_ref, &id_fallback);

                list.push(PluginInfo {
                    id: id_fallback.clone(),
                    name: folder_name.clone(),
                    version: "0.0.0".to_string(),
                    description: None,
                    author: None,
                    enabled: false,
                    api_version: 0,
                    folder_name,
                    folder_path,
                    pre_upload_timeout_ms: 2000,
                    loaded: false,
                    error: Some(e),
                    storage_keys_count: keys_count,
                });
            }
        }
    }

    list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(list)
}

/// Activa o desactiva un plugin actualizando su `plugin.json` y recargando el gestor.
#[tauri::command]
pub async fn toggle_plugin_enabled(
    app_handle: AppHandle,
    folder_name: String,
    enabled: bool,
) -> Result<PluginInfo, String> {
    let plugins_dir = resolve_plugins_dir();
    let plugin_folder = plugins_dir.join(&folder_name);
    let manifest_path = plugin_folder.join("plugin.json");

    if !manifest_path.exists() {
        return Err(format!("No se encontró plugin.json en {:?}", plugin_folder));
    }

    let content = tokio::fs::read_to_string(&manifest_path)
        .await
        .map_err(|e| format!("Error al leer plugin.json: {}", e))?;

    let mut json_val: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Formato JSON inválido en plugin.json: {}", e))?;

    if let Some(obj) = json_val.as_object_mut() {
        obj.insert("enabled".to_string(), serde_json::Value::Bool(enabled));
    } else {
        return Err("plugin.json no contiene un objeto JSON raíz".to_string());
    }

    let updated_json = serde_json::to_string_pretty(&json_val)
        .map_err(|e| format!("Error serializando plugin.json: {}", e))?;

    tokio::fs::write(&manifest_path, updated_json)
        .await
        .map_err(|e| format!("Error escribiendo plugin.json: {}", e))?;

    // Recargar plugins en memoria
    let _ = reload_plugins(app_handle.clone()).await?;

    let plugins = get_installed_plugins(app_handle).await?;
    plugins
        .into_iter()
        .find(|p| p.folder_name == folder_name)
        .ok_or_else(|| "No se encontró el plugin tras actualizarlo".to_string())
}

/// Recarga todos los plugins desde disco y re-ejecuta `on_init`.
#[tauri::command]
pub async fn reload_plugins(app_handle: AppHandle) -> Result<Vec<PluginInfo>, String> {
    let plugins_dir = resolve_plugins_dir();
    let logs_state = app_handle
        .try_state::<AppLogs>()
        .ok_or_else(|| "AppLogs no inicializado".to_string())?;
    let pm_state = app_handle
        .try_state::<AppPluginManager>()
        .ok_or_else(|| "AppPluginManager no inicializado".to_string())?;

    let handle_clone = app_handle.clone();
    let logs_clone = logs_state.inner().clone();
    let pm_arc = pm_state.inner().clone();

    // Recarga síncrona en hilo dedicado para inicializar VMs de Lua
    let tokio_handle = tauri::async_runtime::handle();
    let dir_clone = plugins_dir.clone();

    tokio::task::spawn_blocking(move || {
        let mut manager = crate::plugins::manager::PluginManager::new();
        manager.load_all(dir_clone, handle_clone, logs_clone);
        tokio_handle.block_on(async {
            *pm_arc.lock().await = manager;
        });
    })
    .await
    .map_err(|e| format!("Error en hilo de recarga de plugins: {}", e))?;

    get_installed_plugins(app_handle).await
}

/// Abre la carpeta principal de plugins en el explorador del sistema operativo.
#[tauri::command]
pub async fn open_plugins_folder(app_handle: AppHandle) -> Result<(), String> {
    let plugins_dir = resolve_plugins_dir();
    if !plugins_dir.exists() {
        let _ = std::fs::create_dir_all(&plugins_dir);
    }
    let path_str = plugins_dir.to_string_lossy().to_string();
    app_handle
        .opener()
        .open_path(path_str, None::<&str>)
        .map_err(|e| format!("Error al abrir carpeta de plugins: {}", e))
}

/// Abre la subcarpeta de un plugin específico en el explorador.
#[tauri::command]
pub async fn open_plugin_folder(app_handle: AppHandle, folder_name: String) -> Result<(), String> {
    let plugins_dir = resolve_plugins_dir();
    let target = plugins_dir.join(&folder_name);
    if !target.exists() {
        return Err(format!("La carpeta {:?} no existe", target));
    }
    let path_str = target.to_string_lossy().to_string();
    app_handle
        .opener()
        .open_path(path_str, None::<&str>)
        .map_err(|e| format!("Error al abrir carpeta del plugin: {}", e))
}

/// Abre la subcarpeta de un plugin específico directamente en Visual Studio Code.
#[tauri::command]
pub async fn open_plugin_in_vscode(folder_name: String) -> Result<(), String> {
    let plugins_dir = resolve_plugins_dir();
    let target = plugins_dir.join(&folder_name);
    if !target.exists() {
        return Err(format!("La carpeta {:?} no existe", target));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = std::process::Command::new("cmd");
        cmd.args(["/C", "code", target.to_str().unwrap_or_default()]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.spawn().map_err(|e| {
            format!("Error al ejecutar VS Code: {e}. Asegúrate de tener 'code' en tu PATH.")
        })?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("code")
            .arg(&target)
            .spawn()
            .map_err(|e| {
                format!("Error al ejecutar VS Code: {e}. Asegúrate de tener 'code' en tu PATH.")
            })?;
    }

    Ok(())
}

/// Elimina la subcarpeta de un plugin del disco y opcionalmente limpia su base de datos.
#[tauri::command]
pub async fn delete_plugin(
    app_handle: AppHandle,
    folder_name: String,
    clear_storage: bool,
) -> Result<(), String> {
    let plugins_dir = resolve_plugins_dir();
    let target = plugins_dir.join(&folder_name);

    let manifest = load_manifest_from_dir(&target).ok();
    let plugin_id = manifest
        .map(|m| m.id)
        .unwrap_or_else(|| folder_name.clone());

    if target.exists() {
        tokio::fs::remove_dir_all(&target)
            .await
            .map_err(|e| format!("No se pudo eliminar la carpeta {:?}: {}", target, e))?;
    }

    if clear_storage {
        let _ = clear_plugin_storage(app_handle.clone(), plugin_id).await;
    }

    let _ = reload_plugins(app_handle).await?;
    Ok(())
}

/// Obtiene todos los pares clave-valor guardados por un plugin en la tabla SQLite `plugin_storage`.
#[tauri::command]
pub async fn get_plugin_storage(
    app_handle: AppHandle,
    plugin_id: String,
) -> Result<Vec<PluginStorageEntry>, String> {
    let Some(db) = app_handle.try_state::<AppDb>() else {
        return Ok(Vec::new());
    };

    let p_id = plugin_id.clone();
    let res = db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT key, value, updated_at FROM plugin_storage WHERE plugin_id = ?1 ORDER BY key ASC",
        )?;
        let rows = stmt.query_map(params![p_id], |row| {
            Ok(PluginStorageEntry {
                key: row.get(0)?,
                value: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?;

        let mut entries = Vec::new();
        for r in rows {
            if let Ok(entry) = r {
                entries.push(entry);
            }
        }
        Ok(entries)
    });

    res.map_err(|e| format!("Error consultando SQLite plugin_storage: {}", e))
}

/// Borra todos los datos almacenados por un plugin en `plugin_storage`.
#[tauri::command]
pub async fn clear_plugin_storage(app_handle: AppHandle, plugin_id: String) -> Result<(), String> {
    let Some(db) = app_handle.try_state::<AppDb>() else {
        return Ok(());
    };

    let res = db.with_conn(|conn| {
        conn.execute(
            "DELETE FROM plugin_storage WHERE plugin_id = ?1",
            params![plugin_id],
        )?;
        Ok(())
    });

    res.map_err(|e| format!("Error limpiando SQLite plugin_storage: {}", e))
}
