//! Gestión de consumo de memoria de WebViews (WebView2 en Windows).
//!
//! Permite hibernar y restaurar el consumo de memoria del motor de renderizado (Chromium/WebView2)
//! cuando las ventanas pasan a segundo plano o se ocultan a la bandeja del sistema.

use tauri::{Manager, WebviewWindow, Window};

/// Ajusta el perfil de consumo de memoria de una `WebviewWindow`.
///
/// En Windows (WebView2), el modo `MemoryUsageLevel::Low` solicita al motor de Chromium que:
/// - Purgue cachés de renderizado y texturas GPU innecesarias.
/// - Recolecte basura del heap de V8 (JavaScript runtime).
/// - Reduzca el working set de memoria del proceso de renderizado.
///
/// Se invoca con `low = true` cuando la ventana se oculta a la bandeja (`window.hide()`)
/// o se minimiza, y con `low = false` cuando la ventana vuelve a estar visible y con foco.
pub fn set_webview_memory_level(window: &WebviewWindow, low: bool) {
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, ICoreWebView2_19,
        };
        use windows_core::Interface;

        let target_level = if low {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };

        let _ = window.with_webview(move |webview| {
            unsafe {
                let controller = webview.controller();
                if let Ok(core) = controller.CoreWebView2() {
                    if let Ok(core19) = core.cast::<ICoreWebView2_19>() {
                        let _ = core19.SetMemoryUsageTargetLevel(target_level);
                    }
                }
            }
        });
    }

    #[cfg(not(windows))]
    {
        let _ = window;
        let _ = low;
    }
}

/// Ajusta el perfil de consumo de memoria a partir de una referencia a `Window`.
pub fn set_window_memory_level(window: &Window, low: bool) {
    if let Some(wv) = window.app_handle().get_webview_window(window.label()) {
        set_webview_memory_level(&wv, low);
    }
}
