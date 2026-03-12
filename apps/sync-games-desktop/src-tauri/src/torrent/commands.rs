use crate::torrent::state::TorrentState;
use tauri::State;

/// Descarga un torrent a partir de un magnet link.
#[tauri::command]
pub async fn start_torrent_download(
    magnet: String,
    save_path: String,
    state: State<'_, TorrentState>,
) -> Result<String, String> {
    let mut engine = state.engine.lock().await;
    let info_hash = engine.add_magnet(&magnet, &save_path).await?;

    Ok(info_hash)
}

/// Descarga un torrent a partir de un archivo .torrent del disco.
#[tauri::command]
pub async fn start_torrent_file_download(
    file_path: String,
    save_path: String,
    state: State<'_, TorrentState>,
) -> Result<String, String> {
    let mut engine = state.engine.lock().await;
    let info_hash = engine.add_torrent_file(&file_path, &save_path).await?;

    Ok(info_hash)
}

/// Cancela un torrent activo.
#[tauri::command]
pub async fn cancel_torrent(
    info_hash: String,
    state: State<'_, TorrentState>,
) -> Result<(), String> {
    let mut engine = state.engine.lock().await;
    engine.cancel_torrent(&info_hash, false).await
}
