use crate::commands::logs::sync_logger;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use {
    raw_window_handle::{HasWindowHandle, RawWindowHandle},
    std::ffi::c_void,
    windows::Win32::{
        Foundation::HWND,
        UI::WindowsAndMessaging::{
            SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        },
    },
};

#[cfg(target_os = "windows")]
fn force_topmost(window: &tauri::WebviewWindow) {
    if let Ok(handle) = window.window_handle() {
        if let RawWindowHandle::Win32(h) = handle.as_raw() {
            let hwnd = HWND(h.hwnd.get() as usize as *mut c_void);
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
}

#[derive(Clone)]
struct OverlayNotificationPayload {
    title: String,
    body: String,
}

struct OverlayRuntimeState {
    ready: bool,
    pending: Vec<OverlayNotificationPayload>,
}

static OVERLAY_STATE: OnceLock<Mutex<OverlayRuntimeState>> = OnceLock::new();

fn overlay_state() -> &'static Mutex<OverlayRuntimeState> {
    OVERLAY_STATE.get_or_init(|| {
        Mutex::new(OverlayRuntimeState {
            ready: false,
            pending: Vec::new(),
        })
    })
}

fn emit_overlay_notification(
    app: &AppHandle,
    payload: &OverlayNotificationPayload,
) -> Result<(), String> {
    app.emit_to(
        "overlay",
        "show-overlay-notification",
        serde_json::json!({ "title": payload.title, "body": payload.body }),
    )
    .map_err(|e| e.to_string())
}

fn flush_pending_notifications(app: &AppHandle) {
    let queued = {
        let mut state = match overlay_state().lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };

        if state.pending.is_empty() {
            return;
        }

        std::mem::take(&mut state.pending)
    };

    let flush_count = queued.len();
    sync_logger::log_operation(
        "overlay_flush_pending",
        &format!("pendingCount={}", flush_count),
    );

    for payload in queued {
        let _ = emit_overlay_notification(app, &payload);
    }
}

pub fn setup_overlay_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if app.get_webview_window("overlay").is_some() {
        return Ok(());
    }

    if let Ok(mut state) = overlay_state().lock() {
        state.ready = false;
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

    let _ = window.maximize();
    let _ = window.set_ignore_cursor_events(true);

    #[cfg(target_os = "windows")]
    force_topmost(&window);

    let win_clone = window.clone();
    let app_clone = app.clone();
    let _listener_id = app.listen_any("overlay-ready", move |_| {
        let pending_count = overlay_state()
            .lock()
            .map(|state| state.pending.len())
            .unwrap_or(0);

        sync_logger::log_operation(
            "overlay_ready_received",
            &format!("pendingCount={}", pending_count),
        );

        if let Ok(mut state) = overlay_state().lock() {
            state.ready = true;
        }

        let _ = win_clone.show();
        flush_pending_notifications(&app_clone);
    });

    Ok(())
}

#[tauri::command]
pub async fn show_overlay_notification(
    app: AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    let title_preview: String = title.chars().take(80).collect();
    let body_preview: String = body.chars().take(120).collect();
    sync_logger::log_operation(
        "overlay_show_notification_called",
        &format!("title='{}' body='{}'", title_preview, body_preview),
    );

    if app.get_webview_window("overlay").is_none() {
        setup_overlay_window(&app).map_err(|e| e.to_string())?;
    }

    let window = app
        .get_webview_window("overlay")
        .ok_or("Overlay window not found")?;

    if let Ok(false) = window.is_visible() {
        let _ = window.show();
    }

    #[cfg(target_os = "windows")]
    force_topmost(&window);

    let payload = OverlayNotificationPayload { title, body };

    let is_ready = overlay_state()
        .lock()
        .map(|state| state.ready)
        .unwrap_or(false);

    if !is_ready {
        if let Ok(mut state) = overlay_state().lock() {
            state.pending.push(payload);
            sync_logger::log_operation(
                "overlay_notification_queued",
                &format!("pendingCount={}", state.pending.len()),
            );
        }
        return Ok(());
    }

    sync_logger::log_operation("overlay_notification_emit_immediate", "overlayReady=true");
    emit_overlay_notification(&app, &payload)?;

    Ok(())
}
