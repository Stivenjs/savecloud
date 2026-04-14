//! Módulo de gestión para servicios en la nube de SaveCloud.
//!
//! Este módulo agrupa toda la lógica relacionada con las comunicaciones remotas,
//! específicamente la gestión de conexiones WebSocket seguras para notificaciones en tiempo real,
//! sincronización de estado entre usuarios y broadcasts de actividad de juegos.

pub mod ws_client;   // Lógica de bajo nivel de la conexión (tungstenite).
pub mod ws_manager;  // Gestión del estado compartido de la conexión en Tauri.
pub mod ws_commands; // Comandos de la API de Tauri expuestos al frontend.

pub use ws_manager::CloudWsState;
