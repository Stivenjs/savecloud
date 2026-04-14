use serde::{Deserialize, Serialize};

/// Progreso de descarga de un torrent, emitido como evento Tauri al frontend.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentProgressPayload {
    pub info_hash: String,
    pub name: String,
    pub progress_percent: f32,
    pub download_speed_bytes: u64,
    pub upload_speed_bytes: u64,
    pub state: TorrentDownloadState,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub eta_seconds: Option<u64>,
    pub peers_connected: u32,
}

/// Estado legible de una descarga torrent.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum TorrentDownloadState {
    #[serde(rename = "starting")]
    Starting,
    #[serde(rename = "downloading")]
    Downloading,
    #[serde(rename = "paused")]
    Paused,
    #[serde(rename = "completed")]
    Completed,
}

/// Información de un archivo .torrent almacenado en la nube.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudTorrentInfo {
    pub game_id: String,
    pub key: String,
    pub filename: String,
    pub last_modified: String,
    pub size: Option<u64>,
}
