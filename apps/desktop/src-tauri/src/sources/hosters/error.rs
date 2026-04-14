//! Errores del subsistema de resolución de enlaces por hoster.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum HosterError {
    #[error("URL inválida: {0}")]
    InvalidUrl(String),

    #[error("No se pudo resolver el enlace: {0}")]
    ResolutionFailed(String),

    #[error("VikingFile requiere el servicio Nimbus; no está disponible en SaveCloud")]
    VikingFileNimbus,

    #[error("HTTP {0}")]
    Http(u16),

    #[error("Error de red: {0}")]
    Network(#[from] reqwest::Error),
}
