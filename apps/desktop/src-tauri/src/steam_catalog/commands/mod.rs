//! Comandos Tauri para el catálogo Steam en SQLite.
//!
//! Separados por responsabilidad: [`sync`], [`listing`], [`details`]. Los `#[tauri::command]`
//! deben vivir en estos submódulos (no reexportar con `pub use`: Tauri genera `__cmd__*` en el mismo módulo).

pub mod details;
pub mod listing;
pub mod sync;
pub mod trending;
