//! Eventos IPC del subsistema de fuentes.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::notifications::writer;

use super::domain::{DownloadProtocol, SourceDownloadJob, SourceJobStatus};

/// Nombre del evento de progreso continuo.
pub const SOURCES_PROGRESS_EVENT: &str = "sources-download-progress";
/// Nombre del evento terminal de un job.
pub const SOURCES_TERMINAL_EVENT: &str = "sources-download-terminal";
/// Nombre del evento emitido al actualizar o modificar catálogos de fuentes.
pub const SOURCES_CATALOG_UPDATED_EVENT: &str = "sources-catalog-updated";

/// Payload serializable para progreso/terminal.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceProgressPayload {
    pub job_id: String,
    pub title: String,
    pub protocol: DownloadProtocol,
    pub status: SourceJobStatus,
    pub loaded: u64,
    pub total: u64,
    pub download_speed_bytes: u64,
    pub eta_seconds: Option<u64>,
    pub external_id: Option<String>,
    pub error: Option<String>,
    pub status_detail: Option<String>,
}

/// Emite actualización de progreso.
pub fn emit_progress(app: &AppHandle, job: &SourceDownloadJob) {
    let payload = SourceProgressPayload {
        job_id: job.job_id.clone(),
        title: job.title.clone(),
        protocol: job.protocol.clone(),
        status: job.status.clone(),
        loaded: job.loaded,
        total: job.total,
        download_speed_bytes: job.download_speed_bytes,
        eta_seconds: job.eta_seconds,
        external_id: job.external_id.clone(),
        error: job.error.clone(),
        status_detail: job.status_detail.clone(),
    };
    let _ = app.emit(SOURCES_PROGRESS_EVENT, payload);
}

/// Emite estado terminal.
pub fn emit_terminal(app: &AppHandle, job: &SourceDownloadJob) {
    let payload = SourceProgressPayload {
        job_id: job.job_id.clone(),
        title: job.title.clone(),
        protocol: job.protocol.clone(),
        status: job.status.clone(),
        loaded: job.loaded,
        total: job.total,
        download_speed_bytes: job.download_speed_bytes,
        eta_seconds: job.eta_seconds,
        external_id: job.external_id.clone(),
        error: job.error.clone(),
        status_detail: job.status_detail.clone(),
    };
    let _ = app.emit(SOURCES_TERMINAL_EVENT, payload);
    writer::try_record_source_download_terminal(app, job);
}

/// Emite notificación al frontend cuando la colección de fuentes de juegos cambia o se sincroniza.
pub fn emit_catalog_updated(app: &AppHandle) {
    let _ = app.emit(SOURCES_CATALOG_UPDATED_EVENT, ());
}

/// Nombre del evento de progreso de sincronización de fuentes.
pub const SOURCES_SYNC_PROGRESS_EVENT: &str = "sources-sync-progress";

/// Payload serializable para el progreso en streaming de la sincronización de fuentes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSyncProgressPayload {
    pub in_progress: bool,
    pub current_index: usize,
    pub total_sources: usize,
    pub source_id: Option<String>,
    pub source_url: Option<String>,
    pub source_name: Option<String>,
    pub stage: String,
    pub status_detail: Option<String>,
    pub items_count: Option<usize>,
    pub error: Option<String>,
}

/// Emite actualización del progreso de sincronización de fuentes al frontend.
pub fn emit_sync_progress(app: &AppHandle, payload: &SourceSyncProgressPayload) {
    let _ = app.emit(SOURCES_SYNC_PROGRESS_EVENT, payload);
}
