pub mod api;
pub mod log_buffer;
pub mod manager;
pub mod plugin;
pub mod plugin_sdk;

use std::sync::Arc;
use tokio::sync::Mutex;

pub type AppPluginManager = Arc<Mutex<manager::PluginManager>>;
