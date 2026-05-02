use crate::commands::logs::sync_logger;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, EventId, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

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
    healthy: bool,
    pending: Vec<OverlayNotificationPayload>,
    last_ready_at_ms: Option<i64>,
    last_emit_ok_at_ms: Option<i64>,
    last_emit_error_at_ms: Option<i64>,
    consecutive_emit_errors: u32,
    ready_listener_id: Option<EventId>,
}

static OVERLAY_STATE: OnceLock<Mutex<OverlayRuntimeState>> = OnceLock::new();

fn overlay_state() -> &'static Mutex<OverlayRuntimeState> {
    OVERLAY_STATE.get_or_init(|| {
        Mutex::new(OverlayRuntimeState {
            ready: false,
            healthy: false,
            pending: Vec::new(),
            last_ready_at_ms: None,
            last_emit_ok_at_ms: None,
            last_emit_error_at_ms: None,
            consecutive_emit_errors: 0,
            ready_listener_id: None,
        })
    })
}

const MAX_PENDING_NOTIFICATIONS: usize = 50;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn unlisten_overlay_ready(app: &AppHandle) {
    let listener_id = overlay_state()
        .lock()
        .ok()
        .and_then(|mut state| state.ready_listener_id.take());

    if let Some(id) = listener_id {
        app.unlisten(id);
    }
}

fn register_overlay_ready_listener(app: &AppHandle) {
    unlisten_overlay_ready(app);
    let app_clone = app.clone();

    let listener_id = app.listen_any("overlay-ready", move |_| {
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
            state.healthy = true;
            state.last_ready_at_ms = Some(now_ms());
            state.last_emit_error_at_ms = None;
            state.consecutive_emit_errors = 0;
        }

        if let Some(window) = app_clone.get_webview_window("overlay") {
            let _ = window.show();
        }

        flush_pending_notifications(&app_clone);
    });

    if let Ok(mut state) = overlay_state().lock() {
        state.ready_listener_id = Some(listener_id);
    }
}

fn enqueue_overlay_notification(payload: OverlayNotificationPayload) {
    if let Ok(mut state) = overlay_state().lock() {
        if state.pending.len() >= MAX_PENDING_NOTIFICATIONS {
            state.pending.remove(0);
            sync_logger::log_operation(
                "overlay_pending_dropped_oldest",
                &format!("maxPending={}", MAX_PENDING_NOTIFICATIONS),
            );
        }

        state.pending.push(payload);
        sync_logger::log_operation(
            "overlay_notification_queued",
            &format!("pendingCount={}", state.pending.len()),
        );
    }
}

fn emit_overlay_notification(
    app: &AppHandle,
    payload: &OverlayNotificationPayload,
) -> Result<(), String> {
    let emit_result = app.emit_to(
        "overlay",
        "show-overlay-notification",
        serde_json::json!({ "title": payload.title, "body": payload.body }),
    );

    match emit_result {
        Ok(_) => {
            if let Ok(mut state) = overlay_state().lock() {
                state.healthy = true;
                state.last_emit_ok_at_ms = Some(now_ms());
                state.last_emit_error_at_ms = None;
                state.consecutive_emit_errors = 0;
            }
            Ok(())
        }
        Err(e) => {
            if let Ok(mut state) = overlay_state().lock() {
                state.ready = false;
                state.healthy = false;
                state.last_emit_error_at_ms = Some(now_ms());
                state.consecutive_emit_errors = state.consecutive_emit_errors.saturating_add(1);
            }

            sync_logger::log_error(
                "overlay_emit_failed",
                "No se pudo emitir notificación al overlay",
                &e.to_string(),
            );
            Err(e.to_string())
        }
    }
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
        if emit_overlay_notification(app, &payload).is_err() {
            enqueue_overlay_notification(payload);
            break;
        }
    }
}

fn recreate_overlay_window(app: &AppHandle) -> Result<(), String> {
    sync_logger::log_operation(
        "overlay_recovery_started",
        "reason=unhealthy_or_emit_failed",
    );

    if let Some(window) = app.get_webview_window("overlay") {
        let _ = window.hide();
        let _ = window.destroy();
    }

    if let Ok(mut state) = overlay_state().lock() {
        state.ready = false;
        state.healthy = false;
        state.last_emit_error_at_ms = Some(now_ms());
    }

    setup_overlay_window(app).map_err(|e| e.to_string())?;
    sync_logger::log_operation("overlay_recovery_succeeded", "windowRecreated=true");
    Ok(())
}

fn ensure_overlay_healthy(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window("overlay").is_none() {
        sync_logger::log_operation("overlay_recovery_started", "reason=missing_window");
        return setup_overlay_window(app).map_err(|e| e.to_string());
    }

    let should_recover = overlay_state()
        .lock()
        .map(|state| !state.ready || !state.healthy || state.consecutive_emit_errors >= 2)
        .unwrap_or(true);

    if should_recover {
        recreate_overlay_window(app)?;
    }

    Ok(())
}

pub fn setup_overlay_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    if let Ok(mut state) = overlay_state().lock() {
        state.ready = false;
        state.healthy = false;
    }

    let window = if let Some(existing) = app.get_webview_window("overlay") {
        existing
    } else {
        WebviewWindowBuilder::new(
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
        .build()?
    };

    let _ = window.maximize();
    let _ = window.set_ignore_cursor_events(true);

    #[cfg(target_os = "windows")]
    force_topmost(&window);

    register_overlay_ready_listener(app);

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

    ensure_overlay_healthy(&app)?;

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
        .map(|state| state.ready && state.healthy)
        .unwrap_or(false);

    if !is_ready {
        enqueue_overlay_notification(payload);
        return Ok(());
    }

    sync_logger::log_operation("overlay_notification_emit_immediate", "overlayReady=true");
    if let Err(err) = emit_overlay_notification(&app, &payload) {
        sync_logger::log_operation(
            "overlay_health_degraded",
            &format!("reason=emit_failed error={}", err),
        );
        enqueue_overlay_notification(payload);
        if let Err(recovery_err) = recreate_overlay_window(&app) {
            sync_logger::log_error(
                "overlay_recovery_failed",
                "No se pudo recuperar overlay tras fallo de emisión",
                &recovery_err,
            );
        }
    }

    Ok(())
}
