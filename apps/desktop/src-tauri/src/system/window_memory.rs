//! Gestión de consumo de memoria de WebViews (Windows, Linux y macOS).
//!
//! Permite hibernar y restaurar el consumo de memoria del motor de renderizado
//! cuando las ventanas pasan a segundo plano o se ocultan a la bandeja del sistema.

use tauri::{Manager, WebviewWindow, Window};

/// Perfil de consumo de memoria objetivo para un WebView.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MemoryLevel {
    /// Perfil normal de consumo y máximo rendimiento.
    #[default]
    Normal,
    /// Perfil reducido de memoria: purga cachés, reduce el working set y optimiza recolección de basura.
    Low,
}

impl MemoryLevel {
    /// Retorna `true` si el nivel corresponde a bajo consumo (`MemoryLevel::Low`).
    #[inline]
    pub const fn is_low(self) -> bool {
        matches!(self, Self::Low)
    }

    /// Retorna `true` si el nivel corresponde a consumo normal (`MemoryLevel::Normal`).
    #[inline]
    pub const fn is_normal(self) -> bool {
        matches!(self, Self::Normal)
    }
}

impl From<bool> for MemoryLevel {
    #[inline]
    fn from(low: bool) -> Self {
        if low {
            Self::Low
        } else {
            Self::Normal
        }
    }
}

impl From<MemoryLevel> for bool {
    #[inline]
    fn from(level: MemoryLevel) -> Self {
        level.is_low()
    }
}

/// Ajusta el perfil de consumo de memoria de una `WebviewWindow` utilizando el enum tipado `MemoryLevel`.
///
/// ### Comportamiento por plataforma:
/// - **Windows (WebView2 / Chromium)**: Utiliza `ICoreWebView2_19::SetMemoryUsageTargetLevel` para
///   solicitar la purga de cachés de renderizado, recolectar basura en V8 y comprimir el working set.
/// - **Linux (WebKitGTK + glibc)**: Dispara recolección en el runtime JS y ejecuta `malloc_trim(0)`
///   para devolver páginas libres del heap al kernel.
/// - **macOS (WKWebView)**: Dispara recolección de memoria JS complementando la suspensión nativa
///   de WebKit (*App Nap* y *Process Throttling*).
pub fn set_webview_memory_target(window: &WebviewWindow, level: MemoryLevel) {
    // Windows: WebView2 (Chromium)
    #[cfg(windows)]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;

        let target_level = match level {
            MemoryLevel::Low => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            MemoryLevel::Normal => COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };

        let res = window.with_webview(move |webview| unsafe {
            let controller = webview.controller();
            match controller.CoreWebView2() {
                Ok(core) => match core.cast::<ICoreWebView2_19>() {
                    Ok(core19) => {
                        if let Err(e) = core19.SetMemoryUsageTargetLevel(target_level) {
                            log::debug!("Fallo al establecer nivel de memoria en WebView2: {e:?}");
                        }
                    }
                    Err(e) => {
                        log::debug!(
                            "ICoreWebView2_19 no disponible en este WebView2 runtime: {e:?}"
                        );
                    }
                },
                Err(e) => {
                    log::debug!("No se pudo obtener CoreWebView2 desde controller: {e:?}");
                }
            }
        });

        if let Err(e) = res {
            log::debug!("Fallo al acceder al WebView nativo en Windows: {e:?}");
        }
    }

    // Linux: WebKitGTK + libc malloc_trim
    #[cfg(target_os = "linux")]
    {
        if level.is_low() {
            let _ = window.eval("if (window.gc) { window.gc(); }");

            unsafe {
                libc::malloc_trim(0);
            }
        }
    }

    // macOS: WKWebView (App Nap & JS GC)
    #[cfg(target_os = "macos")]
    {
        if level.is_low() {
            let _ = window.eval("if (window.gc) { window.gc(); }");
        }
    }

    // Fallback para otras plataformas no soportadas
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = window;
        let _ = level;
    }
}

/// Ajusta el perfil de consumo de memoria de una `WebviewWindow` a partir de un valor booleano.
///
/// Pasa `low = true` para hibernar/reducir memoria (por ejemplo al minimizar u ocultar a la bandeja),
/// y `low = false` cuando la ventana vuelve a primer plano.
#[inline]
pub fn set_webview_memory_level(window: &WebviewWindow, low: bool) {
    set_webview_memory_target(window, MemoryLevel::from(low));
}

/// Ajusta el perfil de consumo de memoria a partir de una referencia a `Window`.
#[inline]
pub fn set_window_memory_level(window: &Window, low: bool) {
    set_window_memory_target(window, MemoryLevel::from(low));
}

/// Ajusta el perfil de consumo de memoria a partir de una referencia a `Window` usando `MemoryLevel`.
pub fn set_window_memory_target(window: &Window, level: MemoryLevel) {
    if let Some(wv) = window.app_handle().get_webview_window(window.label()) {
        set_webview_memory_target(&wv, level);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_level_default_is_normal() {
        assert_eq!(MemoryLevel::default(), MemoryLevel::Normal);
    }

    #[test]
    fn test_memory_level_from_bool() {
        assert_eq!(MemoryLevel::from(true), MemoryLevel::Low);
        assert_eq!(MemoryLevel::from(false), MemoryLevel::Normal);
    }

    #[test]
    fn test_bool_from_memory_level() {
        assert!(bool::from(MemoryLevel::Low));
        assert!(!bool::from(MemoryLevel::Normal));
    }

    #[test]
    fn test_memory_level_predicates() {
        let low = MemoryLevel::Low;
        let normal = MemoryLevel::Normal;

        assert!(low.is_low());
        assert!(!low.is_normal());

        assert!(normal.is_normal());
        assert!(!normal.is_low());
    }
}
