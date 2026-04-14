//! Base de datos local **SQLite** para el catálogo Steam (sembrado, listados y `details_json` enriquecido).
//!
//! Se usa **`rusqlite`** con SQLite embebido (`bundled`) para no depender de binarios del SO.
//! El SQL **no** se expone al frontend: solo comandos Tauri invocan este módulo.
//!
//! # Diseño
//!
//! - Un archivo [`crate::config::paths::sqlite_catalog_path`] bajo el directorio `data/`.
//! - Migraciones versionadas con `PRAGMA user_version` ([`migrations::run_migrations`]).
//! - [`AppDb`] vive en el estado de Tauri (`app.manage`) y serializa el acceso con [`std::sync::Mutex`].
//!
//! Para operaciones que puedan bloquear el runtime async, los comandos pueden usar
//! `tokio::task::spawn_blocking` alrededor de [`AppDb::with_conn`].

mod connection;
pub mod error;
mod migrations;

pub use connection::AppDb;

#[cfg(test)]
pub(crate) use migrations::run_migrations;
