use tauri::{AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use {
    raw_window_handle::{HasWindowHandle, RawWindowHandle},
    windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        },
    },
};

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

    #[cfg(target_os = "windows")]
    if let Ok(handle) = window.window_handle() {
        if let RawWindowHandle::Win32(h) = handle.as_raw() {
            let hwnd = HWND(h.hwnd.get() as *mut std::ffi::c_void);
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }

    let win_clone = window.clone();
    app.listen_any("overlay-ready", move |_| {
        let _ = win_clone.show();
    });

    Ok(())
}

#[tauri::command]
pub async fn show_overlay_notification(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    if app.get_webview_window("overlay").is_none() {
        setup_overlay_window(&app).map_err(|e| e.to_string())?;
    }

    let Some(window) = app.get_webview_window("overlay") else {
        return Err("Overlay window not found".to_string());
    };

    if let Ok(false) = window.is_visible() {
        let _ = window.show();
    }

    #[cfg(target_os = "windows")]
    if let Ok(handle) = window.window_handle() {
        if let RawWindowHandle::Win32(h) = handle.as_raw() {
            let hwnd = HWND(h.hwnd.get() as *mut std::ffi::c_void);
            unsafe {
                let _ = SetWindowPos(
                    hwnd,
                    HWND_TOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }

    app.emit_to(
        "overlay",
        "show-overlay-notification",
        serde_json::json!({ "title": title, "body": body }),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}
