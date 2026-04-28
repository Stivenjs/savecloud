use thiserror::Error;

#[derive(Debug, Error)]
pub enum VoiceError {
    #[error("No se encontró dispositivo de entrada de audio")]
    NoInputDevice,
    #[error("Error de audio (cpal): {0}")]
    Cpal(String),
    #[error("Error de wake word (rustpotter): {0}")]
    Rustpotter(String),
    #[error("No se pudo resolver el recurso del wake word: {0}")]
    ResourceNotFound(String),
    #[error("El listener de voz ya está activo")]
    AlreadyRunning,
    #[error("No se pudo bloquear el estado compartido de voz")]
    StatePoisoned,
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for VoiceError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
