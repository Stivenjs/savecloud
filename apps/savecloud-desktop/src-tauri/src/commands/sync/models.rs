//! Definiciones de datos compartidas para procesos de sincronización.
//!
//! Contiene los DTOs y estructuras utilizadas para la comunicación
//! entre componentes del sistema, incluyendo operaciones de subida,
//! descarga y resolución de estado.
//!
//! Estas estructuras garantizan consistencia en el intercambio de datos
//! entre cliente y backend.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SaveFileDto {
    pub absolute: String,
    pub relative: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSaveDto {
    pub game_id: String,
    pub key: String,
    pub last_modified: String,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SyncResultDto {
    pub ok_count: u32,
    pub err_count: u32,
    pub errors: Vec<String>,
}

/// Resultado de un juego dentro de una operación batch (subir/descargar todos).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSyncResultDto {
    pub game_id: String,
    pub result: SyncResultDto,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSaveInfoDto {
    pub game_id: String,
    pub key: String,
    pub filename: String,
    pub last_modified: String,
    pub size: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfoDto {
    pub id: String,
    pub created_at: String,
    pub file_count: u32,
}

/// Resultado de la limpieza de backups antiguos.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupBackupsResultDto {
    pub backups_deleted: u32,
    pub games_affected: u32,
}

/// Payload para eventos de progreso de subida/descarga (sync-upload-progress, sync-download-progress).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncProgressPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub game_id: String,
    pub filename: String,
    pub loaded: u64,
    pub total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub downloaded_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_pause: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_cancel: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveDownloadStateDto {
    pub id: String,
    pub kind: String,
    pub game_id: Option<String>,
    pub name: String,
    pub state: String,
    pub loaded: u64,
    pub total: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncTerminalPayload {
    pub operation_id: String,
    pub status: String,
    pub r#type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFileDto {
    pub filename: String,
    pub size: u64,
    pub local_newer: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewUploadDto {
    pub file_count: u32,
    pub total_size_bytes: u64,
    pub files: Vec<PreviewFileDto>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewDownloadDto {
    pub file_count: u32,
    pub total_size_bytes: u64,
    pub files: Vec<PreviewFileDto>,
    pub conflict_count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnsyncedGameDto {
    pub game_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadConflictDto {
    pub filename: String,
    pub local_modified: String,
    pub cloud_modified: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadConflictsResultDto {
    pub conflicts: Vec<DownloadConflictDto>,
}

/// Resultado de conflictos de descarga para un juego (usado en batch).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameConflictsResultDto {
    pub game_id: String,
    pub conflicts: Vec<DownloadConflictDto>,
}
