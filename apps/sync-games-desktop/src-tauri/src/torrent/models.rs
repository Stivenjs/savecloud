use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct TorrentProgress {
    pub info_hash: String,
    pub name: String,
    pub progress_percent: f32,
    pub download_speed_bytes: u64,
    /// "Iniciando", "Descargando", "Completo"
    pub state: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
}
