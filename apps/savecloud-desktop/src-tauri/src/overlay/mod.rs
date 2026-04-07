use tauri::{AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn setup_overlay_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window("overlay").is_some() {
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        "overlay",
        WebviewUrl::App("index.html?overlay=true".into()),
    )
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .maximizable(false)
    .minimizable(false)
    .resizable(false)
    .title("SaveCloud Overlay")
    .visible(false)
    .build()?;

    let _ = window.set_ignore_cursor_events(true);

    let _ = window.maximize();

    let win_clone = window.clone();
    app.listen_any("overlay-ready", move |_| {
        let _ = win_clone.show();
    });

    Ok(())
}

/// Muestra el overlay y emite la notificación al frontend.
/// Este comando se invoca desde el frontend cuando llega un mensaje WebSocket
/// para asegurar que la ventana esté visible y al frente.
#[tauri::command]
pub async fn show_overlay_notification(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    // Asegurar que la ventana overlay existe
    if app.get_webview_window("overlay").is_none() {
        setup_overlay_window(&app).map_err(|e| e.to_string())?;
    }

    let Some(window) = app.get_webview_window("overlay") else {
        return Err("Overlay window not found".to_string());
    };

    // Asegurar que la ventana esté visible
    if let Ok(false) = window.is_visible() {
        let _ = window.show();
    }

    // Traer al frente - usar request_user_attention y set_focus para forzar
    let _ = window.set_focus();

    // Emitir la notificación al frontend del overlay
    app.emit_to(
        "overlay",
        "show-overlay-notification",
        serde_json::json!({ "title": title, "body": body }),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
