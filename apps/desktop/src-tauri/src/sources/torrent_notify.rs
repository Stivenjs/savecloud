//! Notificación de completado de torrents al sistema de sources.

use tauri::AppHandle;

use crate::sources::domain::{DownloadProtocol, SourceJobStatus};
use crate::sources::events;
use crate::sources::store;

/// Verifica si el estado es terminal (completed, failed, cancelled)
fn is_terminal_status(status: &SourceJobStatus) -> bool {
    matches!(
        status,
        SourceJobStatus::Completed | SourceJobStatus::Failed | SourceJobStatus::Cancelled
    )
}

/// Notifica al sistema de sources que un torrent ha completado.
/// Solo actualiza jobs que están activos (no los ya completados de descargas anteriores).
pub fn torrent_complete_notify(app: &AppHandle, info_hash: &str, total_bytes: u64) {
    let mut jobs = match store::load_jobs() {
        Ok(j) => j,
        Err(_) => return,
    };

    let mut updated_ids = Vec::new();

    // Primero: actualizar solo jobs activos (no terminales) que coincidan
    for job in jobs.iter_mut() {
        let is_torrent_protocol = matches!(
            job.protocol,
            DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile
        );

        if is_torrent_protocol
            && job.external_id.as_deref() == Some(info_hash)
            && !is_terminal_status(&job.status)
        {
            job.status = SourceJobStatus::Completed;
            job.loaded = total_bytes;
            job.total = total_bytes;
            job.updated_at = chrono::Utc::now().to_rfc3339();
            updated_ids.push(job.job_id.clone());
        }
    }

    if updated_ids.is_empty() {
        return;
    }

    // Segundo: emitir evento terminal solo para los jobs que acabamos de actualizar
    for job in jobs.iter().filter(|j| updated_ids.contains(&j.job_id)) {
        events::emit_terminal(app, job);
    }

    let _ = store::save_jobs(&jobs);
}
