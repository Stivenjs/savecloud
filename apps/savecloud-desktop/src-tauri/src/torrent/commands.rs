use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::network::{API_CLIENT, DATA_CLIENT};
use crate::torrent::engine;
use crate::torrent::errors::TorrentError;
use crate::torrent::models::CloudTorrentInfo;
use crate::torrent::state::TorrentState;

/// Descarga un torrent a partir de un magnet link.
///
/// El mutex del engine se libera antes de la operación lenta (resolución DHT),
/// así cancel/pause pueden actuar inmediatamente.
///
/// Los trackers se obtienen del caché precalentado del engine. Si el caché
/// estaba vacío en el momento de la llamada, [`engine::add_magnet_to_session`]
/// los solicitará de forma síncrona sin impacto en la firma de este comando.
#[tauri::command]
pub async fn start_torrent_download(
    magnet: String,
    save_path: String,
    state: State<'_, TorrentState>,
    app: AppHandle,
) -> Result<String, TorrentError> {
    let (session, cached_trackers) = {
        let engine = state.engine.lock().await;
        (engine.session(), engine.cached_trackers())
    };

    let (info_hash, name, id) =
        engine::add_magnet_to_session(&session, &magnet, &save_path, cached_trackers).await?;
    engine::emit_starting_event(&app, &info_hash, &name);

    {
        let mut eng = state.engine.lock().await;
        eng.register_active(info_hash.clone());
    }

    engine::spawn_progress_monitor(
        session,
        id,
        info_hash.clone(),
        name,
        app,
        Some(state.engine.clone()),
    );

    Ok(info_hash)
}

/// Descarga un torrent a partir de un archivo .torrent del disco.
///
/// Los trackers se obtienen del caché precalentado del engine. Si el caché
/// estaba vacío en el momento de la llamada, [`engine::add_file_to_session`]
/// los solicitará de forma síncrona sin impacto en la firma de este comando.
#[tauri::command]
pub async fn start_torrent_file_download(
    file_path: String,
    save_path: String,
    state: State<'_, TorrentState>,
    app: AppHandle,
) -> Result<String, TorrentError> {
    let (session, cached_trackers) = {
        let engine = state.engine.lock().await;
        (engine.session(), engine.cached_trackers())
    };

    let (info_hash, name, id) =
        engine::add_file_to_session(&session, &file_path, &save_path, cached_trackers).await?;
    engine::emit_starting_event(&app, &info_hash, &name);

    {
        let mut eng = state.engine.lock().await;
        eng.register_active(info_hash.clone());
    }

    engine::spawn_progress_monitor(
        session,
        id,
        info_hash.clone(),
        name,
        app,
        Some(state.engine.clone()),
    );

    Ok(info_hash)
}

/// Cancela un torrent activo. Usa la sesión librqbit directamente (sin depender del HashMap).
#[tauri::command]
pub async fn cancel_torrent(
    info_hash: String,
    state: State<'_, TorrentState>,
    app: AppHandle,
) -> Result<(), TorrentError> {
    let session = {
        let mut engine = state.engine.lock().await;
        engine.unregister_active(&info_hash);
        engine.session()
    };

    engine::cancel_via_session(&session, &info_hash).await?;
    let _ = app.emit(engine::TORRENT_CANCELLED_EVENT, &info_hash);
    crate::notifications::writer::try_record_torrent_cancelled(&app, &info_hash, &info_hash);

    // Si no quedan torrents activos tras la cancelación, completar el guard.
    {
        let eng = state.engine.lock().await;
        if eng.active_hashes().is_empty() {
            if let Some(guard_state) = app.try_state::<crate::setup::TorrentShutdownGuard>() {
                if let Ok(mut g) = guard_state.0.lock() {
                    if let Some(guard) = g.take() {
                        guard.complete();
                    }
                }
            }
        }
    }

    Ok(())
}

/// Pausa un torrent activo. No necesita el mutex del engine.
#[tauri::command]
pub async fn pause_torrent(
    info_hash: String,
    state: State<'_, TorrentState>,
) -> Result<(), TorrentError> {
    let session = {
        let engine = state.engine.lock().await;
        engine.session()
    };

    engine::pause_via_session(&session, &info_hash).await
}

/// Reanuda un torrent pausado. No necesita el mutex del engine.
#[tauri::command]
pub async fn resume_torrent(
    info_hash: String,
    state: State<'_, TorrentState>,
) -> Result<(), TorrentError> {
    let session = {
        let engine = state.engine.lock().await;
        engine.session()
    };

    engine::resume_via_session(&session, &info_hash).await
}

/// Sube un archivo .torrent a la nube asociado a un juego.
///
/// El archivo se almacena bajo el prefijo `__torrent__/` del juego,
/// de modo que se puede listar y descargar posteriormente.
#[tauri::command]
pub async fn upload_torrent_to_cloud(
    game_id: String,
    torrent_path: String,
) -> Result<(), TorrentError> {
    let ctx = get_api_context()?;

    let path = PathBuf::from(&torrent_path);
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| {
            TorrentError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Nombre de archivo inválido",
            ))
        })?
        .to_string();

    let remote_filename = format!("__torrent__/{}", file_name);

    let bytes = tokio::fs::read(&torrent_path).await?;

    let upload_urls = crate::commands::sync::api::get_upload_urls(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        &game_id,
        &[remote_filename],
    )
    .await
    .map_err(|e| TorrentError::CloudUrls(e))?;

    let (upload_url, _) = upload_urls
        .into_iter()
        .next()
        .ok_or_else(|| TorrentError::CloudUrls("API no devolvió URL de subida".into()))?;

    let content_length = bytes.len();
    let res = DATA_CLIENT
        .put(&upload_url)
        .body(bytes)
        .header("Content-Type", "application/x-bittorrent")
        .header("Content-Length", content_length.to_string())
        .send()
        .await
        .map_err(|e| TorrentError::CloudDownload(e.to_string()))?;

    if !res.status().is_success() {
        return Err(TorrentError::CloudDownload(format!(
            "S3 PUT falló: {}",
            res.status()
        )));
    }

    Ok(())
}

/// Lista los archivos .torrent almacenados en la nube para un juego.
#[tauri::command]
pub async fn list_cloud_torrents(game_id: String) -> Result<Vec<CloudTorrentInfo>, TorrentError> {
    // Optimización: lista solo los objetos de este juego.
    let all_saves = crate::commands::sync::api::sync_list_remote_saves_for_game(game_id.clone())
        .await
        .map_err(|e| TorrentError::CloudUrls(e))?;

    let torrents = all_saves
        .into_iter()
        .filter(|s| s.filename.starts_with("__torrent__/"))
        .map(|s| CloudTorrentInfo {
            game_id: s.game_id,
            key: s.key,
            filename: s.filename.trim_start_matches("__torrent__/").to_string(),
            last_modified: s.last_modified,
            size: s.size,
        })
        .collect();

    Ok(torrents)
}

/// Descarga un archivo .torrent desde la nube e inicia la descarga P2P.
///
/// Los trackers se obtienen del caché precalentado del engine, igual que en
/// [`start_torrent_file_download`], para evitar latencia de red adicional
/// en el camino crítico de inicio de descarga.
#[tauri::command]
pub async fn download_torrent_from_cloud(
    game_id: String,
    torrent_key: String,
    save_path: String,
    state: State<'_, TorrentState>,
    app: AppHandle,
) -> Result<String, TorrentError> {
    let ctx = get_api_context()?;

    let download_urls = crate::commands::sync::api::get_download_urls(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        &[(game_id.clone(), torrent_key.clone())],
    )
    .await
    .map_err(|e| TorrentError::CloudUrls(e))?;

    let (download_url, _) = download_urls
        .into_iter()
        .next()
        .ok_or_else(|| TorrentError::CloudUrls("API no devolvió URL de descarga".into()))?;

    let res = API_CLIENT
        .get(&download_url)
        .send()
        .await
        .map_err(|e| TorrentError::CloudDownload(e.to_string()))?;

    if !res.status().is_success() {
        return Err(TorrentError::CloudDownload(format!(
            "Descarga falló: {}",
            res.status()
        )));
    }

    let torrent_bytes = res
        .bytes()
        .await
        .map_err(|e| TorrentError::CloudDownload(e.to_string()))?;

    let temp_dir = std::env::temp_dir().join("SaveCloud-torrents");
    tokio::fs::create_dir_all(&temp_dir).await?;

    let temp_file = temp_dir.join(format!("{}.torrent", &game_id));
    tokio::fs::write(&temp_file, &torrent_bytes).await?;

    let temp_path = temp_file
        .to_str()
        .ok_or_else(|| {
            TorrentError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Ruta temporal inválida",
            ))
        })?
        .to_string();

    let (session, cached_trackers) = {
        let engine = state.engine.lock().await;
        (engine.session(), engine.cached_trackers())
    };

    let (info_hash, name, id) =
        engine::add_file_to_session(&session, &temp_path, &save_path, cached_trackers).await?;
    engine::emit_starting_event(&app, &info_hash, &name);

    {
        let mut eng = state.engine.lock().await;
        eng.register_active(info_hash.clone());
    }

    engine::spawn_progress_monitor(
        session,
        id,
        info_hash.clone(),
        name,
        app,
        Some(state.engine.clone()),
    );

    Ok(info_hash)
}

#[tauri::command]
pub async fn get_active_torrent_downloads(
    state: State<'_, TorrentState>,
) -> Result<Vec<String>, TorrentError> {
    let engine = state.engine.lock().await;
    Ok(engine.active_hashes())
}

/// Elimina un archivo .torrent almacenado en la nube (S3).
#[tauri::command]
pub async fn delete_cloud_torrent(
    game_id: String,
    torrent_key: String,
) -> Result<(), TorrentError> {
    let ctx = get_api_context()?;
    let body = serde_json::json!({ "gameId": game_id, "key": torrent_key });

    let res = crate::commands::sync::api::api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "DELETE",
        "/backup",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| TorrentError::CloudUrls(e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        return Err(TorrentError::CloudDownload(format!(
            "API DELETE torrent: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        )));
    }
    Ok(())
}

fn get_api_context() -> Result<crate::commands::sync::context::ApiContext, TorrentError> {
    crate::commands::sync::context::resolve_api_context().map_err(TorrentError::Config)
}
