use serde::Serialize;

/// Error de comando serializable. Tauri envía este objeto al frontend en lugar de
/// incluir detalles de transporte en una cadena de texto formateada.
#[derive(Debug, Serialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[error("{message}")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    pub retryable: bool,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            status: None,
            request_id: None,
            retryable: false,
        }
    }

    pub fn api(
        code: impl Into<String>,
        message: impl Into<String>,
        status: u16,
        request_id: Option<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            status: Some(status),
            request_id,
            retryable: status == 408 || status == 429 || status >= 500,
        }
    }

    pub fn network() -> Self {
        Self {
            retryable: true,
            ..Self::new(
                "NETWORK_ERROR",
                "No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.",
            )
        }
    }

    pub fn unexpected() -> Self {
        Self::new(
            "INTERNAL_ERROR",
            "Ocurrió un error inesperado. Inténtalo de nuevo más tarde.",
        )
    }
}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::new("LOCAL_ERROR", message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        Self::new("LOCAL_ERROR", message)
    }
}
