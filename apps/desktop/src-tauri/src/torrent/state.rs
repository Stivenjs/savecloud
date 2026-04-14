use std::sync::Arc;

use tokio::sync::Mutex;

use crate::torrent::engine::TorrentEngine;

pub struct TorrentState {
    pub engine: Arc<Mutex<TorrentEngine>>,
}
