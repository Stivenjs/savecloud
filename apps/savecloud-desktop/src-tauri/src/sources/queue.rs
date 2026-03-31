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

/// Ejecuta un job en segundo plano según protocolo.
pub fn spawn_job(app: AppHandle, job_id: String) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<SourcesState>();
        let result = run_job(&app, &state, &job_id).await;
        if let Err(err) = result {
            if let Ok(mut job) = find_job(&state, &job_id) {
                if job.status != SourceJobStatus::Cancelled {
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
                |loaded, total| {
                    let mut current = find_job(state, job_id)?;
                    current.loaded = loaded;
                    current.total = total;
                    current.updated_at = now_iso();
                    state.upsert_job(current.clone())?;
                    emit_progress(app, &current);
                    Ok(())
                },
            )
            .await;

            match result {
                Ok(done) => {
                    let mut done_job = find_job(state, job_id)?;
                    done_job.status = SourceJobStatus::Completed;
                    done_job.loaded = done.loaded;
                    done_job.total = done.total;
                    done_job.updated_at = now_iso();
                    state.upsert_job(done_job.clone())?;
                    emit_progress(app, &done_job);
                    emit_terminal(app, &done_job);
                }
                Err(err) if err == "cancelled" => {
                    let mut cancelled = find_job(state, job_id)?;
                    cancelled.status = SourceJobStatus::Cancelled;
                    cancelled.updated_at = now_iso();
                    state.upsert_job(cancelled.clone())?;
                    emit_progress(app, &cancelled);
                    emit_terminal(app, &cancelled);
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
            running.external_id = Some(start.info_hash.clone());
            running.updated_at = now_iso();
            state.upsert_job(running.clone())?;
            emit_progress(app, &running);
            spawn_torrent_monitor(app.clone(), job_id.to_string(), start.info_hash);
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

fn find_job(state: &SourcesState, job_id: &str) -> Result<SourceDownloadJob, String> {
    state
        .list_jobs()
        .into_iter()
        .find(|j| j.job_id == job_id)
        .ok_or_else(|| format!("Job no encontrado: {job_id}"))
}

/// Crea un ID para job nuevo.
pub fn new_job_id() -> String {
    format!("srcjob-{}", chrono::Utc::now().timestamp_millis())
}

/// Timestamp estándar RFC3339.
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}
