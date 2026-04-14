//! Errores del sembrado del catálogo Steam.

/// Fallos al sincronizar con `IStoreService/GetAppList` o al persistir en SQLite.
#[derive(Debug, thiserror::Error)]
pub enum CatalogSyncError {
    #[error("Falta la clave Steam Web API (settings `steamWebApiKey` o variable de entorno STEAM_WEB_API_KEY)")]
    MissingApiKey,

    #[error("HTTP al contactar Steam: {0}")]
    Http(#[from] reqwest::Error),

    #[error("Steam respondió HTTP {0}")]
    HttpStatus(u16),

    #[error("Respuesta JSON inesperada de GetAppList")]
    InvalidResponse,

    #[error("Límite de seguridad de lotes alcanzado (posible bucle); abortado")]
    BatchLimit,

    #[error("SQLite: {0}")]
    Rusqlite(#[from] rusqlite::Error),

    #[error("Acceso a la base de datos local: {0}")]
    AppDb(#[from] crate::sqlite::error::SqliteError),
}
