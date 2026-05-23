//! Eventos IPC del subsistema de fuentes.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::notifications::writer;

use super::domain::{DownloadProtocol, SourceDownloadJob, SourceJobStatus};

/// Nombre del evento de progreso continuo.
pub const SOURCES_PROGRESS_EVENT: &str = "sources-download-progress";
/// Nombre del evento terminal de un job.
pub const SOURCES_TERMINAL_EVENT: &str = "sources-download-terminal";

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
    };
    let _ = app.emit(SOURCES_TERMINAL_EVENT, payload);
    writer::try_record_source_download_terminal(app, job);
}
