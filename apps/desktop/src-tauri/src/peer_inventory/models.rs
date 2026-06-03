//! Modelos del manifiesto de inventario por dispositivo.

use serde::{Deserialize, Serialize};

/// Entrada de un archivo en el manifiesto verificado.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryFileEntry {
    pub relative_path: String,
    pub size: u64,
    pub hash: String,
}

/// Archivo de fuentes (torrent/HTTP) indexado como fallback.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourcesArchiveEntry {
    pub job_id: String,
    pub relative_path: String,
    pub size: u64,
    pub hash: String,
    pub verified_at: String,
}

/// Juego verificado en este dispositivo.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GameInventoryEntry {
    pub game_key: String,
    pub display_name: String,
    pub status: String,
    pub payload_kind: String,
    pub total_bytes: u64,
    pub file_count: u32,
    pub manifest_hash: String,
    pub verified_at: String,
    pub files: Vec<InventoryFileEntry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources_archive: Option<SourcesArchiveEntry>,
}

/// Manifiesto completo del dispositivo (solo entradas `verified` en cloud).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInventoryManifest {
    pub device_id: String,
    pub device_name: String,
    pub user_id: String,
    pub manifest_version: u32,
    pub content_hash: String,
    pub updated_at: String,
    pub sharing_enabled: bool,
    pub games: Vec<GameInventoryEntry>,
}

/// Payload publicado al API (sin rutas absolutas).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishDeviceInventoryBody {
    pub device_name: String,
    pub manifest_version: u32,
    pub content_hash: String,
    pub updated_at: String,
    pub sharing_enabled: bool,
    pub games: Vec<GameInventoryEntry>,
}

impl DeviceInventoryManifest {
    pub fn to_publish_body(&self) -> PublishDeviceInventoryBody {
        PublishDeviceInventoryBody {
            device_name: self.device_name.clone(),
            manifest_version: self.manifest_version,
            content_hash: self.content_hash.clone(),
            updated_at: self.updated_at.clone(),
            sharing_enabled: self.sharing_enabled,
            games: self.games.clone(),
        }
    }
}
