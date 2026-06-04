//! Checkpoint de descarga peer LAN (pausa / reanudación).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerDownloadCheckpoint {
    pub next_file_index: usize,
    pub loaded_total: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerJobMeta {
    pub game_key: String,
    pub target_user_id: String,
    pub target_device_id: String,
    pub manifest_hash: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkpoint: Option<PeerDownloadCheckpoint>,
}

impl PeerJobMeta {
    pub fn parse(raw: &str) -> Result<Self, String> {
        serde_json::from_str(raw).map_err(|e| format!("Meta peer inválida: {e}"))
    }

    pub fn to_json(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|e| e.to_string())
    }
}

pub const PAUSED_BY_USER: &str = "paused_by_user";
