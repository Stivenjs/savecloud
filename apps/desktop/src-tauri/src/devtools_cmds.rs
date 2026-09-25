//! Inspector nativo del webview (DevTools). En release requiere Cargo `devtools` y preferencia del perfil activo.

use tauri::{AppHandle, Manager};

fn ensure_developer_mode_for_release() -> Result<(), String> {
    #[cfg(not(debug_assertions))]
    {
        if !crate::config::load_settings().developer_mode {
            return Err(
                "Las DevTools solo están disponibles con «Modo desarrollador» activo (Ajustes → Avanzado)."
                    .into(),
            );
        }
    }
    Ok(())
}

#[tauri::command]
pub fn open_webview_devtools(app: AppHandle, window_label: String) -> Result<(), String> {
    ensure_developer_mode_for_release()?;
    let label = window_label.trim();
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("No hay ventana con etiqueta «{label}»."))?;
    window.open_devtools();
    Ok(())
}

#[tauri::command]
pub fn close_webview_devtools(app: AppHandle, window_label: String) -> Result<(), String> {
    ensure_developer_mode_for_release()?;
    let label = window_label.trim();
    let window = app
        .get_webview_window(label)
        .ok_or_else(|| format!("No hay ventana con etiqueta «{label}»."))?;
    window.close_devtools();
    Ok(())
}
