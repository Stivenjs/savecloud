//! DTO compartidos con el frontend (camelCase) y con la API `/notifications` del backend.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Registro almacenado en SQLite y sincronizado con S3 vía API.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRecordDto {
    pub id: String,
    pub user_id: String,
    pub kind: String,
    pub severity: String,
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub game_id: Option<String>,
    #[serde(default)]
    pub operation_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub reason_code: Option<String>,
    #[serde(default)]
    pub payload_json: Option<String>,
    #[serde(default)]
    pub dedup_key: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub read_at: Option<String>,
    #[serde(default)]
    pub dismissed_at: Option<String>,
    #[serde(default)]
    pub source_device_id: Option<String>,
    #[serde(default)]
    pub server_updated_at: Option<String>,
    #[serde(default)]
    pub pending_sync: bool,
    #[serde(default)]
    pub sync_version: i64,
}

/// Cuerpo `POST /notifications/batch` y respuesta parcial de pull.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationBatchBody {
    pub items: Vec<NotificationRecordDto>,
}

/// Respuesta `GET /notifications`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationListResponse {
    pub items: Vec<NotificationRecordDto>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

/// Cuerpo `POST /notifications/ack`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationAckBody {
    pub ids: Vec<String>,
    #[serde(default)]
    pub read: Option<bool>,
    #[serde(default)]
    pub dismiss: Option<bool>,
}

/// Parámetros de listado expuestos al frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListNotificationsParams {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    #[serde(default)]
    pub unread_only: bool,
}

fn default_limit() -> i64 {
    50
}

/// Respuesta combinada para evitar múltiples round-trips al abrir el centro de notificaciones.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSyncFullResponse {
    pub items: Vec<NotificationRecordDto>,
    pub unread_count: i64,
}

/// Normaliza `read_at` / `dismissed_at`: cadenas vacías no son equivalentes a NULL en SQLite y excluyen filas con `IS NULL`.
pub fn normalize_notification_record_for_storage(rec: &mut NotificationRecordDto) {
    rec.read_at = rec.read_at.take().filter(|s| !s.trim().is_empty());
    rec.dismissed_at = rec.dismissed_at.take().filter(|s| !s.trim().is_empty());
}

/// Fingerprint estable: SHA-256 hex de `kind|operation_id|status|game_id` (vacíos como "").
pub fn compute_dedup_key(
    kind: &str,
    operation_id: Option<&str>,
    status: Option<&str>,
    game_id: Option<&str>,
) -> String {
    let op = operation_id.unwrap_or("");
    let st = status.unwrap_or("");
    let g = game_id.unwrap_or("");
    let raw = format!("{kind}|{op}|{st}|{g}");
    hex::encode(Sha256::digest(raw.as_bytes()))
}
