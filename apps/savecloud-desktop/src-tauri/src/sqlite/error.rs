//! Errores del subsistema SQLite local.

/// Error al abrir o consultar la base de datos del catálogo.
#[derive(Debug, thiserror::Error)]
pub enum SqliteError {
    #[error("No se pudo resolver la ruta del archivo SQLite")]
    PathNotResolved,

    #[error("I/O al preparar el directorio de datos: {0}")]
    Io(#[from] std::io::Error),

    #[error("SQLite: {0}")]
    Rusqlite(#[from] rusqlite::Error),

    #[error("Pool de conexiones SQLite: {0}")]
    Pool(String),
}
