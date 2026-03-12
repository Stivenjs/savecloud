use librqbit::{AddTorrent, AddTorrentOptions, Session, SessionOptions};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Clone, Debug, serde::Serialize)]
pub struct TorrentProgress {
    pub info_hash: String,
    pub name: String,
    pub progress_percent: f32,
    pub download_speed_bytes: u64,
    pub state: String,
    pub total_bytes: u64,
    pub downloaded_bytes: u64,
    pub eta_seconds: Option<u64>,
}

#[derive(Clone)]
#[allow(dead_code)]
pub struct ActiveTorrent {
    pub id: usize,
    pub info_hash: String,
    pub name: String,
}

pub struct TorrentEngine {
    session: Arc<Session>,
    active: HashMap<String, ActiveTorrent>,
    progress_tx: broadcast::Sender<TorrentProgress>,
}

impl TorrentEngine {
    pub async fn new(output_folder: PathBuf) -> Self {
        let options = SessionOptions::default();
        let session = Session::new_with_opts(output_folder, options)
            .await
            .expect("Failed to initialize librqbit session");

        let (progress_tx, _) = broadcast::channel(100);

        Self {
            session,
            active: HashMap::new(),
            progress_tx,
        }
    }

    #[allow(dead_code)]
    pub fn subscribe(&self) -> broadcast::Receiver<TorrentProgress> {
        self.progress_tx.subscribe()
    }

    pub async fn add_magnet(
        &mut self,
        magnet_link: &str,
        save_path: &str,
    ) -> Result<String, String> {
        let add_options = AddTorrentOptions {
            output_folder: Some(save_path.into()),
            ..Default::default()
        };

        let response = self
            .session
            .add_torrent(AddTorrent::from_url(magnet_link), Some(add_options))
            .await
            .map_err(|e| format!("Failed to add magnet: {}", e))?;

        let handle = response
            .into_handle()
            .ok_or_else(|| "Torrent was list-only, no handle returned".to_string())?;

        let info_hash = handle.info_hash().as_string();
        let name = handle
            .name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| info_hash.clone());
        let id = handle.id();

        self.active.insert(
            info_hash.clone(),
            ActiveTorrent {
                id,
                info_hash: info_hash.clone(),
                name: name.clone(),
            },
        );

        self.spawn_progress_monitor(id, info_hash.clone(), name);

        Ok(info_hash)
    }

    pub async fn add_torrent_file(
        &mut self,
        file_path: &str,
        save_path: &str,
    ) -> Result<String, String> {
        let add_options = AddTorrentOptions {
            output_folder: Some(save_path.into()),
            ..Default::default()
        };

        let add = AddTorrent::from_local_filename(file_path)
            .map_err(|e| format!("Failed to read .torrent file: {}", e))?;

        let response = self
            .session
            .add_torrent(add, Some(add_options))
            .await
            .map_err(|e| format!("Failed to add torrent: {}", e))?;

        let handle = response
            .into_handle()
            .ok_or_else(|| "Torrent was list-only, no handle returned".to_string())?;

        let info_hash = handle.info_hash().as_string();
        handle.wait_until_initialized().await.ok();

        let name = handle
            .name()
            .map(|s| s.to_string())
            .unwrap_or_else(|| info_hash.clone());
        let id = handle.id();

        self.active.insert(
            info_hash.clone(),
            ActiveTorrent {
                id,
                info_hash: info_hash.clone(),
                name: name.clone(),
            },
        );

        self.spawn_progress_monitor(id, info_hash.clone(), name);

        Ok(info_hash)
    }

    fn spawn_progress_monitor(&self, torrent_id: usize, info_hash: String, name: String) {
        let session = self.session.clone();
        let tx = self.progress_tx.clone();

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));

            loop {
                interval.tick().await;

                if tx.receiver_count() == 0 {
                    continue;
                }

                let managed = match session.get(librqbit::api::TorrentIdOrHash::Id(torrent_id)) {
                    Some(m) => m,
                    None => break,
                };

                let stats = managed.stats();
                let total_bytes = stats.total_bytes;
                let downloaded_bytes = stats.progress_bytes;

                let progress_percent = if total_bytes > 0 {
                    (downloaded_bytes as f64 / total_bytes as f64 * 100.0) as f32
                } else {
                    0.0
                };

                let download_speed_bytes = stats
                    .live
                    .as_ref()
                    .map(|live| (live.download_speed.mbps * 1_000_000.0 / 8.0) as u64)
                    .unwrap_or(0);

                let eta_seconds = stats
                    .live
                    .as_ref()
                    .and_then(|live| live.time_remaining.as_ref())
                    .map(|d| {
                        let real_duration: &std::time::Duration = unsafe { std::mem::transmute(d) };
                        real_duration.as_secs()
                    });

                let state = if stats.finished {
                    "Completo".to_string()
                } else if downloaded_bytes > 0 {
                    "Descargando".to_string()
                } else {
                    "Iniciando".to_string()
                };

                let progress = TorrentProgress {
                    info_hash: info_hash.clone(),
                    name: name.clone(),
                    progress_percent,
                    download_speed_bytes,
                    state,
                    total_bytes,
                    downloaded_bytes,
                    eta_seconds,
                };

                let _ = tx.send(progress);

                if stats.finished {
                    break;
                }
            }
        });
    }

    pub async fn cancel_torrent(
        &mut self,
        info_hash: &str,
        delete_files: bool,
    ) -> Result<(), String> {
        let active = self
            .active
            .remove(info_hash)
            .ok_or_else(|| format!("No active torrent with info_hash: {}", info_hash))?;

        self.session
            .delete(librqbit::api::TorrentIdOrHash::Id(active.id), delete_files)
            .await
            .map_err(|e| format!("Error cancelando en librqbit: {}", e))?;

        Ok(())
    }

    #[allow(dead_code)]
    pub fn active_count(&self) -> usize {
        self.active.len()
    }
}
