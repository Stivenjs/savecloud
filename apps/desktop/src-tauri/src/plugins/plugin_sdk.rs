//! Módulo para exportar el SDK de plugins.
//!
//! Contiene la función para exportar el SDK de plugins.

use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

#[tauri::command]
pub async fn export_plugin_sdk(app_handle: AppHandle) -> Result<String, String> {
    let sdk_content = include_str!("../../lua/savecloud-api.lua");

    let (tx, rx) = oneshot::channel();

    app_handle
        .dialog()
        .file()
        .add_filter("Definiciones Lua", &["lua"])
        .set_file_name("savecloud-api.lua")
        .save_file(move |file_path| {
            let _ = tx.send(file_path);
        });

    let file_path = rx
        .await
        .map_err(|_| "Error al comunicar con el diálogo".to_string())?;

    match file_path {
        Some(path) => {
            let path_buf = path.into_path().map_err(|_| "Ruta inválida".to_string())?;

            tokio::fs::write(&path_buf, sdk_content)
                .await
                .map_err(|e| e.to_string())?;

            Ok(path_buf.to_string_lossy().into_owned())
        }
        None => Err("CANCELADO".to_string()),
    }
}
