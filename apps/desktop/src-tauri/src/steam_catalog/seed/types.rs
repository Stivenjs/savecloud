use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct SteamSeedImportState {
    pub strategy: String,
    pub cursor_last_key: Option<String>,
    pub newest_watermark: Option<String>,
    pub max_imported_batch_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedUploadUrlResponse {
    pub upload_url: String,
    #[serde(rename = "key")]
    pub _key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedBatchesResponse {
    pub keys: Vec<String>,
    pub next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedBatchDownloadUrlResult {
    pub key: String,
    pub url: Option<String>,
    #[allow(dead_code)]
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedBatchDownloadUrlsResponse {
    pub results: Vec<SteamSeedBatchDownloadUrlResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedPriorityDownloadUrlResponse {
    pub download_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedBatchLine {
    pub app_id: u32,
    #[serde(default)]
    pub steam_success: Option<bool>,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedExportResultDto {
    pub app_ids_exported: u32,
    pub parts_uploaded: u32,
    pub priority_ids_uploaded: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedImportResultDto {
    pub batches_processed: u32,
    pub rows_updated: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedImportProgressPayload {
    pub iteration: u32,
    pub batches_this_round: u32,
    pub rows_this_round: u32,
    pub total_batches: u32,
    pub total_rows_updated: u32,
    pub status_text: Option<String>,
    pub current_batch: Option<String>,
    pub done: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedImportRunResultDto {
    pub rounds: u32,
    pub batches_processed: u32,
    pub rows_updated: u32,
    pub trending_priority_entries: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedRemoteStatusDto {
    pub last_batch_key: Option<String>,
    #[allow(dead_code)]
    pub batch_seq: u32,
    #[allow(dead_code)]
    pub catalog_complete: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedFreshnessDto {
    pub status: String,
    pub cloud_last_batch_key: Option<String>,
    pub local_max_batch_key: Option<String>,
    pub error: Option<String>,
}
