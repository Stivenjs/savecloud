//! Tipos de errores centralizados para el subsistema de streaming.

use thiserror::Error;

/// Errores posibles durante el ciclo de vida del streaming (Host o Client).
#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum StreamingError {
    #[error("Error del Host Sunshine: {0}")]
    Host(String),

    #[error("Error del Cliente Moonlight: {0}")]
    Client(String),

    #[error("Fallo de red o servidor HTTP/RTSP: {0}")]
    Network(String),

    #[error("Fallo al generar certificados o claves criptográficas: {0}")]
    Crypto(String),

    #[error("Error de configuración I/O: {0}")]
    Config(String),

    #[error("Fallo FFI en libmoonlight: {0}")]
    Ffi(String),

    #[error("Servidor WebSocket de video error: {0}")]
    WebSocket(String),
}

pub type StreamingResult<T> = Result<T, StreamingError>;
