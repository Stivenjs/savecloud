use tauri::{AppHandle, Emitter};

use super::models::{SyncOperationState, SyncProgressPayload, SyncTerminalPayload};

pub(crate) const SYNC_STATUS_COMPLETED: &str = "completed";
pub(crate) const SYNC_STATUS_FAILED: &str = "failed";

fn derive_state(status: &str) -> SyncOperationState {
    match status {
        "queued" => SyncOperationState::Queued,
        "running" => SyncOperationState::Running,
        "pausing" => SyncOperationState::Pausing,
        "paused" => SyncOperationState::Paused,
        "cancelling" => SyncOperationState::Cancelling,
        "cancelled" => SyncOperationState::Cancelled,
        "completed" => SyncOperationState::Completed,
        _ => SyncOperationState::Failed,
    }
}

fn state_name(state: &SyncOperationState) -> &'static str {
    match state {
        SyncOperationState::Queued => "queued",
        SyncOperationState::Running => "running",
        SyncOperationState::Pausing => "pausing",
        SyncOperationState::Paused => "paused",
        SyncOperationState::Cancelling => "cancelling",
        SyncOperationState::Cancelled => "cancelled",
        SyncOperationState::Completed => "completed",
        SyncOperationState::Failed => "failed",
    }
}

pub(crate) fn emit_sync_terminal(
    app: &AppHandle,
    operation_id: String,
    status: &str,
    ty: &str,
    game_id: Option<String>,
    state: Option<SyncOperationState>,
    reason_code: Option<String>,
) {
    let next_state = state.unwrap_or_else(|| derive_state(status));
    crate::commands::logs::sync_logger::log_transition(
        &operation_id,
        None,
        None,
        state_name(&next_state),
        reason_code.as_deref(),
    );
    let _ = app.emit(
        "sync-operation-terminal",
        SyncTerminalPayload {
            operation_id,
            status: status.to_string(),
            r#type: ty.to_string(),
            game_id,
            strategy: None,
            state: Some(next_state),
            reason_code,
        },
    );
}

pub(crate) fn emit_sync_upload_progress(app: &AppHandle, mut payload: SyncProgressPayload) {
    if payload.can_pause.is_none() {
        payload.can_pause = Some(true);
    }
    if payload.can_cancel.is_none() {
        payload.can_cancel = Some(true);
    }
    if payload.can_resume.is_none() {
        payload.can_resume = Some(false);
    }
    if payload.state.is_none() {
        payload.state = Some(SyncOperationState::Running);
    }
    let _ = app.emit("sync-upload-progress", payload);
}

pub(crate) fn emit_sync_download_progress(app: &AppHandle, mut payload: SyncProgressPayload) {
    if payload.can_pause.is_none() {
        payload.can_pause = Some(false);
    }
    if payload.can_cancel.is_none() {
        payload.can_cancel = Some(false);
    }
    if payload.can_resume.is_none() {
        payload.can_resume = Some(false);
    }
    if payload.state.is_none() {
        payload.state = Some(SyncOperationState::Running);
    }
    let _ = app.emit("sync-download-progress", payload);
}

pub(crate) fn emit_sync_upload_paused(app: &AppHandle, game_id: &str, filename: &str) {
    let _ = app.emit(
        "sync-upload-paused",
        serde_json::json!({
            "gameId": game_id,
            "filename": filename,
            "operationId": format!("sync-upload-{}", game_id),
            "state": "paused",
            "reasonCode": "PAUSED_BY_USER",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derive_state_maps_cancelled() {
        assert!(matches!(
            derive_state("cancelled"),
            SyncOperationState::Cancelled
        ));
    }

    #[test]
    fn derive_state_defaults_to_failed_for_unknown_status() {
        assert!(matches!(
            derive_state("unexpected-status"),
            SyncOperationState::Failed
        ));
    }
}
