//! Módulo central para la gestión de configuración y preferencias.
//!
//! Coordina la lectura, escritura y transformación de los modelos de datos
//! utilizados para la configuración de entorno, biblioteca local y registros
//! de sincronización.

pub mod config_cmds;
pub mod backup_snapshot;
pub mod cloud_backup;
pub mod encrypted_export;
pub mod gamification;
pub mod io;
pub mod local_backup;
mod library_reader;
pub mod models;
pub mod paths;
pub mod profile_cmds;
pub mod profile_defaults;
pub mod profile_io;
pub mod profile_manager;
pub mod profile_storage;
pub mod profiles;
pub mod storage_layout;

pub use io::*;
pub use models::*;
pub use paths::*;
