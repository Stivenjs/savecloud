//! Modo juego: mitigaciones conservadoras para reducir contención (SaveCloud + SO).
//!
//! Extras opcionales elevados por UAC (p. ej. servicios temporales) pueden añadirse como binario lado recursos cuando el producto lo requiera; no forman parte de esta primera versión.

pub mod apply;
pub mod commands;
pub(crate) mod cpu_boost;

mod session_file;

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod os_macos_linux;

#[cfg(target_os = "windows")]
pub(crate) mod os_windows;

use std::sync::Arc;

pub(crate) use cpu_boost::sync_detected_game_cpu_boost;
pub use cpu_boost::DetectedGameProcess;

/// Exclusión mútua de activación/desactivación concurrente desde la UI u otros invokes.
#[derive(Clone)]
pub struct GameModeCtl(pub Arc<tokio::sync::Mutex<()>>);

impl Default for GameModeCtl {
    fn default() -> Self {
        Self(Arc::new(tokio::sync::Mutex::new(())))
    }
}
