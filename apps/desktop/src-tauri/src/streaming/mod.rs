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

