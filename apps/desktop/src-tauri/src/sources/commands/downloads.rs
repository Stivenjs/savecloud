//! Comandos de jobs de descarga desde fuentes.

use tauri::{AppHandle, Emitter, Manager};

use super::super::domain::{DownloadProtocol, SourceDownloadJob, SourceJobStatus};
use super::super::events;
use super::super::queue::{cancel_job, new_job_id, now_iso, spawn_job, SourcesState};
use super::super::store;

/// Lista jobs de descarga activos o recientes.
#[tauri::command]
pub async fn list_source_download_jobs(
    state: tauri::State<'_, SourcesState>,
) -> Result<Vec<SourceDownloadJob>, String> {
    Ok(state.list_jobs())
}

/// Encola una descarga desde un item de catálogo.
#[tauri::command]
pub async fn start_source_download(
    source_id: String,
    item_id: String,
    destination_dir: String,
    preferred_protocol: Option<DownloadProtocol>,
    app: AppHandle,
    state: tauri::State<'_, SourcesState>,
) -> Result<String, String> {
    let sources = store::load_sources()?;
    let source = sources
        .iter()
        .find(|s| s.id == source_id)
        .ok_or_else(|| format!("Fuente no encontrada: {source_id}"))?;
    let item = source
        .downloads
        .iter()
        .find(|s| s.id == item_id)
        .ok_or_else(|| format!("Item no encontrado: {item_id}"))?;

    let selected = if let Some(pref) = preferred_protocol {
        item.uris
            .iter()
            .find(|u| u.protocol == pref)
            .cloned()
            .or_else(|| item.uris.first().cloned())
    } else {
        item.uris
            .iter()
            .find(|u| {
                matches!(
                    u.protocol,
                    DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile
                )
            })
            .cloned()
            .or_else(|| {
                item.uris
                    .iter()
                    .find(|u| u.protocol == DownloadProtocol::Http)
                    .cloned()
            })
            .or_else(|| item.uris.first().cloned())
    }
    .ok_or_else(|| "No hay URIs válidas para descargar".to_string())?;

    let job_id = new_job_id();
    let now = now_iso();
    let job = SourceDownloadJob {
        job_id: job_id.clone(),
        source_id: source_id.clone(),
        item_id: item_id.clone(),
        title: item.title.clone(),
        destination_dir,
        selected_uri: selected.uri,
        protocol: selected.protocol,
        status: SourceJobStatus::Queued,
        loaded: 0,
        total: 0,
        download_speed_bytes: 0,
        eta_seconds: None,
        error: None,
        external_id: None,
        output_file_name: None,
        created_at: now.clone(),
        updated_at: now,
    };

    state.upsert_job(job.clone())?;
    events::emit_progress(&app, &job);
    spawn_job(app, job_id.clone());
    Ok(job_id)
}

/// Cancela un job de descarga en curso.
#[tauri::command]
pub async fn cancel_source_download(
    job_id: String,
    state: tauri::State<'_, SourcesState>,
    app: AppHandle,
) -> Result<(), String> {
    let mut job = state
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;

    if matches!(
        job.status,
        SourceJobStatus::Completed | SourceJobStatus::Cancelled | SourceJobStatus::Failed
    ) {
        return Ok(());
    }

    match job.protocol {
        DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile => {
            if let Some(info_hash) = job.external_id.clone() {
                let torrent_state = app.state::<crate::torrent::state::TorrentState>();
                let session = {
                    let mut engine = torrent_state.engine.lock().await;
                    engine.unregister_active(&info_hash);
                    engine.session()
                };

                let info_hash_clone = info_hash.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = crate::torrent::engine::cancel_via_session(&session, &info_hash_clone)
                        .await;
                });

                let _ = app.emit(crate::torrent::engine::TORRENT_CANCELLED_EVENT, &info_hash);
            }
        }
        DownloadProtocol::Http => {
            if let Some(ref name) = job.output_file_name {
                let path = std::path::PathBuf::from(&job.destination_dir).join(name);
                let _ = tokio::fs::remove_file(path).await;
            }
        }
        _ => {}
    }

    job.status = SourceJobStatus::Cancelled;
    job.updated_at = now_iso();
    job.error = None;
    state.upsert_job(job.clone())?;
    events::emit_progress(&app, &job);
    events::emit_terminal(&app, &job);
    cancel_job(&state, &job_id);
    state.remove_job(&job_id)?;
    Ok(())
}

/// Pausa un job torrent.
#[tauri::command]
pub async fn pause_source_download(job_id: String, app: AppHandle) -> Result<(), String> {
    let sources = app.state::<SourcesState>();
    let mut job = sources
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;

    if job.protocol == DownloadProtocol::Http {
        return Err("Las descargas HTTP no se pueden pausar. Usa cancelar.".to_string());
    }

    match job.protocol {
        DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile => {
            if let Some(info_hash) = job.external_id.clone() {
                let torrent_state = app.state::<crate::torrent::state::TorrentState>();
                let session = {
                    let engine = torrent_state.engine.lock().await;
                    engine.session()
                };

                let info_hash_clone = info_hash.clone();
                tauri::async_runtime::spawn(async move {
                    let _ =
                        crate::torrent::engine::pause_via_session(&session, &info_hash_clone).await;
                });
            }
        }
        _ => {}
    }

    job.status = SourceJobStatus::Paused;
    job.updated_at = now_iso();
    sources.upsert_job(job.clone())?;
    events::emit_progress(&app, &job);
    Ok(())
}

/// Reanuda un job torrent pausado.
#[tauri::command]
pub async fn resume_source_download(job_id: String, app: AppHandle) -> Result<(), String> {
    let sources = app.state::<SourcesState>();
    let mut job = sources
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| "Job no encontrado".to_string())?;

    if job.protocol == DownloadProtocol::Http {
        return Err(
            "Las descargas HTTP no se pueden reanudar. Inicia la descarga de nuevo.".to_string(),
        );
    }

    job.status = SourceJobStatus::Queued;
    job.updated_at = now_iso();
    sources.upsert_job(job.clone())?;

    let is_torrent = matches!(
        job.protocol,
        DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile
    );
    let mut resumed_via_session = false;

    if is_torrent {
        if let Some(info_hash) = &job.external_id {
            let torrent_state = app.state::<crate::torrent::state::TorrentState>();
            let session = {
                let engine = torrent_state.engine.lock().await;
                engine.session()
            };
            if crate::torrent::engine::resume_via_session(&session, info_hash)
                .await
                .is_ok()
            {
                resumed_via_session = true;
                job.status = SourceJobStatus::Running;
                job.updated_at = now_iso();
                sources.upsert_job(job.clone())?;
                events::emit_progress(&app, &job);
            }
        }
    }

    if !resumed_via_session {
        spawn_job(app, job_id);
    }

    Ok(())
}
