//! Cola de ejecución y estado de jobs de fuentes.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::torrent::state::TorrentState;

use super::domain::{DownloadProtocol, SourceDownloadJob, SourceJobStatus};
use super::events::{emit_progress, emit_terminal};
use super::http_runner;
use super::store;
use super::torrent_runner;

/// Estado global del módulo `sources`.
pub struct SourcesState {
    jobs: Mutex<Vec<SourceDownloadJob>>,
    cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl SourcesState {
    /// Construye el estado rehidratando jobs desde disco.
    pub fn new_from_disk() -> Self {
        let jobs = store::load_jobs().unwrap_or_default();
        Self {
            jobs: Mutex::new(jobs),
            cancel_flags: Mutex::new(HashMap::new()),
        }
    }

    /// Lista jobs en memoria.
    pub fn list_jobs(&self) -> Vec<SourceDownloadJob> {
        self.jobs.lock().map(|g| g.clone()).unwrap_or_default()
    }

    /// Inserta o actualiza un job, persistiendo cambios.
    pub fn upsert_job(&self, next: SourceDownloadJob) -> Result<(), String> {
        let mut guard = self
            .jobs
            .lock()
            .map_err(|_| "Mutex de jobs envenenado".to_string())?;
        if let Some(existing) = guard.iter_mut().find(|j| j.job_id == next.job_id) {
            *existing = next;
        } else {
            guard.push(next);
        }
        store::save_jobs(&guard)
    }

    /// Elimina un job del estado y del almacenamiento persistente.
    pub fn remove_job(&self, job_id: &str) -> Result<(), String> {
        let mut guard = self
            .jobs
            .lock()
            .map_err(|_| "Mutex de jobs envenenado".to_string())?;
        guard.retain(|j| j.job_id != job_id);
        store::save_jobs(&guard)
    }

    /// Marca cancelación solicitada para un job.
    pub fn cancel(&self, job_id: &str) {
        if let Ok(flags) = self.cancel_flags.lock() {
            if let Some(flag) = flags.get(job_id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    /// Crea un token de cancelación y lo asocia al job.
    pub fn create_cancel_flag(&self, job_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        if let Ok(mut flags) = self.cancel_flags.lock() {
            flags.insert(job_id.to_string(), flag.clone());
        }
        flag
    }

    fn clear_cancel_flag(&self, job_id: &str) {
        if let Ok(mut flags) = self.cancel_flags.lock() {
            flags.remove(job_id);
        }
    }
}

/// Rehidrata y relanza trabajos que quedaron a medias al cerrar la app
pub fn resume_pending_jobs(app: &AppHandle) {
    let state = app.state::<SourcesState>();
    let jobs = state.list_jobs();

    for mut job in jobs {
        if job.protocol == DownloadProtocol::Http && job.status == SourceJobStatus::Paused {
            job.status = SourceJobStatus::Cancelled;
            job.error = Some("Descarga HTTP interrumpida (pausa no soportada)".to_string());
            job.updated_at = now_iso();
            let _ = state.upsert_job(job);
            continue;
        }
        if job.status == SourceJobStatus::Running || job.status == SourceJobStatus::Queued {
            job.status = SourceJobStatus::Queued;
            job.updated_at = now_iso();
            if state.upsert_job(job.clone()).is_ok() {
                spawn_job(app.clone(), job.job_id.clone());
            }
        }
    }
}

pub fn spawn_job(app: AppHandle, job_id: String) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<SourcesState>();
        let result = run_job(&app, &state, &job_id).await;

        if let Err(err) = result {
            if let Ok(mut job) = find_job(&state, &job_id) {
                if err == "stopped_by_user" && job.status == SourceJobStatus::Cancelled {
                    let _ = state.remove_job(&job_id);
                } else if err == "stopped_by_user" {
                    // Detención cooperativa sin cancelar (p. ej. torrent pausado): conservar job.
                } else if job.status == SourceJobStatus::Cancelled {
                    let _ = state.remove_job(&job_id);
                } else {
                    job.status = SourceJobStatus::Failed;
                    job.error = Some(err);
                    job.updated_at = now_iso();
                    let _ = state.upsert_job(job.clone());
                    emit_progress(&app, &job);
                    emit_terminal(&app, &job);
                }
            }
        }
        state.clear_cancel_flag(&job_id);
    });
}

async fn run_job(app: &AppHandle, state: &SourcesState, job_id: &str) -> Result<(), String> {
    let mut job = find_job(state, job_id)?;
    job.status = SourceJobStatus::Running;
    job.updated_at = now_iso();
    job.error = None;
    state.upsert_job(job.clone())?;
    emit_progress(app, &job);

    match job.protocol {
        DownloadProtocol::Http => {
            let cancel_flag = state.create_cancel_flag(job_id);
            let result = http_runner::run_http_download(
                &job.title,
                &job.destination_dir,
                &job.selected_uri,
                cancel_flag,
                |output_file_name| {
                    let mut current = find_job(state, job_id)?;
                    current.output_file_name = Some(output_file_name.to_string());
                    current.updated_at = now_iso();
                    state.upsert_job(current.clone())?;
                    emit_progress(app, &current);
                    Ok(())
                },
                |loaded, total, download_speed_bytes, eta_seconds| {
                    emit_job_download_progress(
                        app,
                        state,
                        job_id,
                        loaded,
                        total,
                        download_speed_bytes,
                        eta_seconds,
                    )
                },
            )
            .await;

            match result {
                Ok(done) => {
                    let mut done_job = find_job(state, job_id)?;
                    done_job.status = SourceJobStatus::Completed;
                    done_job.loaded = done.loaded;
                    done_job.total = done.total;
                    done_job.output_file_name = Some(done.output_file_name);
                    done_job.updated_at = now_iso();
                    state.upsert_job(done_job.clone())?;
                    emit_progress(app, &done_job);
                    emit_terminal(app, &done_job);
                    state.remove_job(job_id)?;
                    spawn_inventory_rescan_after_download();
                }
                Err(err) if err == "stopped_by_user" => {
                    let current = find_job(state, job_id)?;
                    if current.status == SourceJobStatus::Cancelled {
                        emit_terminal(app, &current);
                    }
                    return Err(err);
                }
                Err(err) => return Err(err),
            }
        }
        DownloadProtocol::TorrentMagnet | DownloadProtocol::TorrentFile => {
            let start = torrent_runner::start_torrent(
                app,
                job.protocol.clone(),
                &job.selected_uri,
                &job.destination_dir,
            )
            .await?;

            let mut running = find_job(state, job_id)?;

            if running.status == SourceJobStatus::Cancelled
                || running.status == SourceJobStatus::Paused
            {
                running.external_id = Some(start.info_hash.clone());
                running.updated_at = now_iso();
                state.upsert_job(running.clone())?;

                let torrent_state = app.state::<TorrentState>();
                let session = {
                    let engine = torrent_state.engine.lock().await;
                    engine.session()
                };

                if running.status == SourceJobStatus::Cancelled {
                    let _ = crate::torrent::engine::cancel_via_session(&session, &start.info_hash)
                        .await;
                } else {
                    let _ =
                        crate::torrent::engine::pause_via_session(&session, &start.info_hash).await;
                }

                emit_progress(app, &running);
                if running.status == SourceJobStatus::Cancelled {
                    emit_terminal(app, &running);
                }
                return Ok(());
            }

            running.external_id = Some(start.info_hash.clone());
            running.updated_at = now_iso();
            state.upsert_job(running.clone())?;
            emit_progress(app, &running);
            spawn_torrent_monitor(app.clone(), job_id.to_string(), start.info_hash);
        }
        DownloadProtocol::PeerLan => {
            let cancel_flag = state.create_cancel_flag(job_id);
            let peer_meta: serde_json::Value =
                serde_json::from_str(&job.selected_uri).map_err(|e| format!("Meta peer: {e}"))?;
            let game_key = peer_meta["gameKey"]
                .as_str()
                .ok_or_else(|| "gameKey ausente".to_string())?
                .to_string();
            let target_user_id = peer_meta["targetUserId"]
                .as_str()
                .ok_or_else(|| "targetUserId ausente".to_string())?
                .to_string();
            let target_device_id = peer_meta["targetDeviceId"]
                .as_str()
                .ok_or_else(|| "targetDeviceId ausente".to_string())?
                .to_string();
            let manifest_hash = peer_meta["manifestHash"]
                .as_str()
                .ok_or_else(|| "manifestHash ausente".to_string())?
                .to_string();

            let params = crate::peer_lan::PeerDownloadParams {
                game_key,
                destination_dir: job.destination_dir.clone(),
                target_user_id,
                target_device_id,
                manifest_hash,
            };

            let result = crate::peer_lan::run_peer_download(
                params,
                cancel_flag,
                |loaded, total, download_speed_bytes, eta_seconds| {
                    emit_job_download_progress(
                        app,
                        state,
                        job_id,
                        loaded,
                        total,
                        download_speed_bytes,
                        eta_seconds,
                    )
                },
            )
            .await;

            match result {
                Ok(()) => {
                    let mut done_job = find_job(state, job_id)?;
                    done_job.status = SourceJobStatus::Completed;
                    done_job.updated_at = now_iso();
                    state.upsert_job(done_job.clone())?;
                    emit_progress(app, &done_job);
                    emit_terminal(app, &done_job);
                    state.remove_job(job_id)?;
                    spawn_inventory_rescan_after_download();
                }
                Err(err) if err == "stopped_by_user" => {
                    let current = find_job(state, job_id)?;
                    if current.status == SourceJobStatus::Cancelled {
                        emit_terminal(app, &current);
                    }
                    return Err(err);
                }
                Err(err) => return Err(err),
            }
        }
        DownloadProtocol::Unknown => return Err("Protocolo no soportado".to_string()),
    }

    Ok(())
}

fn spawn_torrent_monitor(app: AppHandle, job_id: String, info_hash: String) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(900)).await;
            let state = app.state::<SourcesState>();
            let torrent_state = app.state::<TorrentState>();
            let session = {
                let engine = torrent_state.engine.lock().await;
                engine.session()
            };
            let Ok(hash) = librqbit::api::TorrentIdOrHash::try_from(info_hash.as_str()) else {
                break;
            };
            let Some(managed) = session.get(hash) else {
                break;
            };
            let stats = managed.stats();
            let mut job = match find_job(&state, &job_id) {
                Ok(v) => v,
                Err(_) => break,
            };

            if job.status == SourceJobStatus::Cancelled || job.status == SourceJobStatus::Failed {
                break;
            }
            if job.status != SourceJobStatus::Paused {
                job.loaded = stats.progress_bytes;
                job.total = stats.total_bytes;
            }
            if stats.finished {
                job.status = SourceJobStatus::Completed;
            }
            job.updated_at = now_iso();
            if state.upsert_job(job.clone()).is_ok() {
                emit_progress(&app, &job);
                if job.status == SourceJobStatus::Completed {
                    emit_terminal(&app, &job);
                    let _ = state.remove_job(&job_id);
                    break;
                }
            }
        }
    });
}

/// Cancela un job existente.
pub fn cancel_job(state: &SourcesState, job_id: &str) {
    state.cancel(job_id);
}

fn spawn_inventory_rescan_after_download() {
    tauri::async_runtime::spawn(async {
        let _ = crate::peer_inventory::publish_local_inventory(true).await;
    });
}

fn find_job(state: &SourcesState, job_id: &str) -> Result<SourceDownloadJob, String> {
    state
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| format!("Job no encontrado: {job_id}"))
}

fn emit_job_download_progress(
    app: &AppHandle,
    state: &SourcesState,
    job_id: &str,
    loaded: u64,
    total: u64,
    download_speed_bytes: u64,
    eta_seconds: Option<u64>,
) -> Result<(), String> {
    let mut current = find_job(state, job_id)?;
    current.loaded = loaded;
    current.total = total;
    if download_speed_bytes > 0 {
        current.download_speed_bytes = download_speed_bytes;
    }
    if let Some(eta) = eta_seconds {
        current.eta_seconds = Some(eta);
    } else if total > loaded {
        let speed = if download_speed_bytes > 0 {
            download_speed_bytes
        } else {
            current.download_speed_bytes
        };
        if speed > 0 {
            current.eta_seconds =
                crate::utils::transfer_metrics::compute_eta(total, loaded, speed);
        }
    }
    current.updated_at = now_iso();
    state.upsert_job(current.clone())?;
    emit_progress(app, &current);
    Ok(())
}

/// Crea un ID para job nuevo.
pub fn new_job_id() -> String {
    format!("srcjob-{}", chrono::Utc::now().timestamp_millis())
}

/// Timestamp estándar RFC3339.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
