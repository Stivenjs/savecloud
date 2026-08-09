//! Tipos de errores centralizados para el subsistema de streaming.

use thiserror::Error;

/// Errores posibles durante el ciclo de vida del streaming (Host o Client).
#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum StreamingError {
    #[error("Error del Host Sunshine: {0}")]
    HostError(String),

    #[error("Error del Cliente Moonlight: {0}")]
    ClientError(String),

    #[error("Fallo de red o servidor HTTP/RTSP: {0}")]
    NetworkError(String),

    #[error("Fallo al generar certificados o claves criptográficas: {0}")]
    CryptoError(String),

    #[error("Error de configuración I/O: {0}")]
    ConfigError(String),

    #[error("Fallo FFI en libmoonlight: {0}")]
    FfiError(String),

    #[error("Servidor WebSocket de video error: {0}")]
    WebSocketError(String),
}

pub type StreamingResult<T> = Result<T, StreamingError>;
