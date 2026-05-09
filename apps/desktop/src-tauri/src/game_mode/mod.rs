//! Modo juego: mitigaciones conservadoras para reducir contención (SaveCloud + SO).
//!
//! Extras opcionales elevados por UAC (p. ej. servicios temporales) pueden añadirse como binario lado recursos cuando el producto lo requiera; no forman parte de esta primera versión.

pub mod apply;
pub mod commands;

mod session_file;

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod os_macos_linux;

#[cfg(target_os = "windows")]
pub(crate) mod os_windows;

use std::sync::Arc;

/// Exclusión mútua de activación/desactivación concurrente desde la UI u otros invokes.
#[derive(Clone)]
pub struct GameModeCtl(pub Arc<tokio::sync::Mutex<()>>);

impl Default for GameModeCtl {
    fn default() -> Self {
        Self(Arc::new(tokio::sync::Mutex::new(())))
    }
}
