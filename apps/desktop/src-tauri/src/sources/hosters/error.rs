//! Errores del subsistema de resolución de enlaces por hoster.

use crate::network::HttpStatusError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HosterError {
    #[error("URL inválida: {0}")]
    InvalidUrl(String),

    #[error("No se pudo resolver el enlace: {0}")]
    ResolutionFailed(String),

    #[error("HTTP {0}")]
    Http(u16),

    #[error("Error de red: {0}")]
    Network(#[from] reqwest::Error),
}

impl From<HttpStatusError> for HosterError {
    fn from(e: HttpStatusError) -> Self {
        match e.status {
            401 | 403 | 404 | 429 => HosterError::ResolutionFailed(e.user_message()),
            _ if e.phase == crate::network::RequestPhase::Download => {
                HosterError::ResolutionFailed(e.user_message())
            }
            s => HosterError::Http(s),
        }
    }
}

pub fn ensure_resolve(response: reqwest::Response) -> Result<reqwest::Response, HosterError> {
    crate::network::ensure_resolve_success(response).map_err(HosterError::from)
}

pub fn map_json_error(e: reqwest::Error, hoster: &str) -> HosterError {
    if e.is_decode() {
        HosterError::ResolutionFailed(format!(
            "{hoster}: el servidor devolvió una página web en lugar de JSON (¿Cloudflare/CAPTCHA?)"
        ))
    } else {
        HosterError::Network(e)
    }
}
