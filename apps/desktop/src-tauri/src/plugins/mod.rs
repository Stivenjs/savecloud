pub mod api;
pub mod log_buffer;
pub mod manager;
pub mod manifest;
pub mod plugin;
pub mod plugin_sdk;

use std::sync::Arc;
use tokio::sync::Mutex;

pub type AppPluginManager = Arc<Mutex<manager::PluginManager>>;

/// Versión de API de plugins soportada por el core.
pub const SUPPORTED_PLUGIN_API_VERSION: u32 = 1;

/// Timeout por defecto de `on_pre_upload` en milisegundos.
pub const DEFAULT_PRE_UPLOAD_TIMEOUT_MS: u64 = 2_000;

/// Timeout mínimo permitido para `on_pre_upload`.
pub const MIN_PRE_UPLOAD_TIMEOUT_MS: u64 = 250;

/// Timeout máximo permitido para `on_pre_upload`.
pub const MAX_PRE_UPLOAD_TIMEOUT_MS: u64 = 10_000;
