use tauri::{AppHandle, Emitter};

use super::models::{SyncProgressPayload, SyncTerminalPayload};

pub(crate) const SYNC_STATUS_COMPLETED: &str = "completed";
pub(crate) const SYNC_STATUS_FAILED: &str = "failed";

pub(crate) fn emit_sync_terminal(
    app: &AppHandle,
    operation_id: String,
    status: &str,
    ty: &str,
    game_id: Option<String>,
) {
    let _ = app.emit(
        "sync-operation-terminal",
        SyncTerminalPayload {
            operation_id,
            status: status.to_string(),
            r#type: ty.to_string(),
            game_id,
        },
    );
}

pub(crate) fn emit_sync_upload_progress(app: &AppHandle, payload: SyncProgressPayload) {
    let _ = app.emit("sync-upload-progress", payload);
}

pub(crate) fn emit_sync_download_progress(app: &AppHandle, payload: SyncProgressPayload) {
    let _ = app.emit("sync-download-progress", payload);
}

pub(crate) fn emit_sync_upload_paused(app: &AppHandle, game_id: &str, filename: &str) {
    let _ = app.emit(
        "sync-upload-paused",
        serde_json::json!({
            "gameId": game_id,
            "filename": filename,
            "operationId": format!("sync-upload-{}", game_id),
        }),
    );
}

pub(crate) fn emit_sync_upload_done(app: &AppHandle) {
    let _ = app.emit("sync-upload-done", ());
}

pub(crate) fn emit_sync_download_done(app: &AppHandle) {
    let _ = app.emit("sync-download-done", ());
}

pub(crate) fn emit_full_backup_done(app: &AppHandle) {
    let _ = app.emit("full-backup-done", ());
}

pub(crate) fn sync_status_from_result<T, E>(result: &Result<T, E>) -> &'static str {
    if result.is_ok() {
        SYNC_STATUS_COMPLETED
    } else {
        SYNC_STATUS_FAILED
    }
}

pub(crate) fn sync_status_from_err_count(err_count: u32) -> &'static str {
    if err_count == 0 {
        SYNC_STATUS_COMPLETED
    } else {
        SYNC_STATUS_FAILED
    }
}
