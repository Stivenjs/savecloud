use crate::torrent::engine::TorrentEngine;
use std::sync::Arc;
use tokio::sync::Mutex;

#[allow(dead_code)]
pub struct TorrentState {
    pub engine: Arc<Mutex<TorrentEngine>>,
    pub app_handle: tauri::AppHandle,
}
