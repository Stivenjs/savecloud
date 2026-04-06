use tauri::{AppHandle, Listener, Manager, WebviewUrl, WebviewWindowBuilder};

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
        println!("[Overlay] Received 'overlay-ready' signal. Showing window.");
        let _ = win_clone.show();
    });

    Ok(())
}
