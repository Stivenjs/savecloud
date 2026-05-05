//! Ventana mínima de “Saliendo…” creada desde el proceso nativo (tray).
//!
//! En Windows/WebView2, crear la ventana **fuera del hilo principal** puede fallar de
//! forma silenciosa cuando el flujo llega desde el menú del tray vía Tokio.

use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;

pub const SHUTDOWN_WINDOW_LABEL: &str = "shutdown-window";

static SPLASH_MOUNT_ACK_TX: Mutex<Option<oneshot::Sender<()>>> = Mutex::new(None);

/// Prepara espera asíncrona a que la webview de splash ejecute [`signal_shutdown_splash_mounted`].
pub fn arm_shutdown_splash_mount_ack() -> oneshot::Receiver<()> {
    let (tx, rx) = oneshot::channel();
    let mut slot = SPLASH_MOUNT_ACK_TX
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    *slot = Some(tx);
    rx
}

/// Llamado desde el frontend cuando [`ShutdownWindowPage`] monta (splash visible).
pub fn signal_shutdown_splash_mounted() {
    if let Ok(mut g) = SPLASH_MOUNT_ACK_TX.lock() {
        if let Some(tx) = g.take() {
            let _ = tx.send(());
        }
    }
}

/// Muestra (o enfoca) la webview dedicada `shutdown-window` cargando el modo
/// `shutdownWindow` del front.
pub fn show_shutdown_splash_window(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SHUTDOWN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.center();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.set_always_on_top(true);
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app,
        SHUTDOWN_WINDOW_LABEL,
        WebviewUrl::App("index.html?shutdownWindow=true".into()),
    )
    .title("Saliendo de SaveCloud")
    .transparent(true)
    .decorations(false)
    .always_on_top(true)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .inner_size(720.0, 440.0)
    .min_inner_size(720.0, 440.0)
    .max_inner_size(720.0, 440.0)
    .visible(true)
    .center()
    .build()?;

    let _ = window.show();
    let _ = window.set_focus();
    let _ = window.set_always_on_top(true);

    Ok(())
}
