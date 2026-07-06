//! Comandos Tauri del módulo de fuentes (organizados por responsabilidad).

pub mod catalog;
pub mod downloads;
pub mod fetch;
pub mod match_index;
pub mod remote;

pub use downloads::{pause_source_download, resume_source_download};
pub use match_index::{init_match_config, preload_index_background};
