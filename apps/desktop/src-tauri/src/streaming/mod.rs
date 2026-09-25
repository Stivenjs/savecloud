//! Subsistema de game streaming entre peers (LAN-first).
//!
//! Integra el protocolo GameStream (Sunshine ↔ Moonlight) de forma nativa
//! dentro de SaveCloud, permitiendo a los miembros del cloud compartir
//! su pantalla y jugar juntos en la misma red local.
//!
//! ## Arquitectura
//!
//! - [`bindings`] — FFI con moonlight-common-c (bindgen)
//! - `host` — Orquestación de Sunshine (Fase 2)
//! - `client` — Cliente Moonlight desde Rust (Fase 3)
//! - `discovery` — Descubrimiento LAN via mDNS (Fase 2)
//! - `session` — Estado de sesión de streaming (Fase 2)
//! - `renderer` — Decodificación + renderizado de video (Fase 4)
//! - `input_relay` — Inyección de inputs del gamepad (Fase 3)

#[cfg(test)]
mod test_launch;
pub mod bindings;
pub mod host;
pub mod discovery;
pub mod session;
pub mod client;
pub mod input_relay;
pub mod commands;
pub mod audio;
pub mod crypto;
pub mod error;
pub mod tls_override;
pub mod video_server;
pub mod webtransport_server;
pub mod input_listener;

use std::sync::atomic::{AtomicBool, Ordering};

/// Bandera atómica global para indicar si la sesión de streaming actual es en Modo Espejo (loopback local a 127.0.0.1).
///
/// En este modo, el Host y el Cliente se ejecutan en la misma máquina física.
/// Se desactivan la inyección de inputs y la reproducción de audio en el cliente
/// para prevenir bucles de retroalimentación infinitos (feedback loops) y eco acústico.
static IS_MIRROR_MODE: AtomicBool = AtomicBool::new(false);

/// Establece el estado activo del Modo Espejo.
pub fn set_mirror_mode(active: bool) {
    let prev = IS_MIRROR_MODE.swap(active, Ordering::Relaxed);
    if prev != active {
        log::info!("[Streaming] Estado de Modo Espejo (Prueba Local): {}", active);
    }
}

/// Consulta si el Modo Espejo está activo en la sesión actual.
#[inline]
pub fn is_mirror_mode() -> bool {
    IS_MIRROR_MODE.load(Ordering::Relaxed)
}

