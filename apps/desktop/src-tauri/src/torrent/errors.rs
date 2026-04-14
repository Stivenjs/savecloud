/// Errores del subsistema de descargas P2P (BitTorrent).
#[derive(Debug, thiserror::Error)]
pub enum TorrentError {
    #[error("No se pudo inicializar la sesión librqbit: {0}")]
    SessionInit(String),

    #[error("No se pudo añadir el magnet link: {0}")]
    AddMagnet(String),

    #[error("No se pudo leer el archivo .torrent: {0}")]
    ReadTorrentFile(String),

    #[error("No se pudo añadir el torrent: {0}")]
    AddTorrent(String),

    #[error("El torrent era solo de lista, no devolvió handle")]
    ListOnly,

    #[error("No hay torrent activo con info_hash: {0}")]
    NotFound(String),

    #[error("Error al cancelar el torrent: {0}")]
    Cancel(String),

    #[error("Error al pausar el torrent: {0}")]
    Pause(String),

    #[error("Error al reanudar el torrent: {0}")]
    Resume(String),

    #[error("Error de red al descargar .torrent desde la nube: {0}")]
    CloudDownload(String),

    #[error("Error al obtener URLs de descarga: {0}")]
    CloudUrls(String),

    #[error("Configuración incompleta: {0}")]
    Config(String),

    #[error("Error de I/O: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for TorrentError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
