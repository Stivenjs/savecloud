//! DTOs y estructuras compartidas para sincronización.

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResultDto {
    pub ok_count: u32,
    pub err_count: u32,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
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
