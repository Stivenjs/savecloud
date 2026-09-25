//! Adaptador del módulo sources al motor torrent existente.

use tauri::{AppHandle, Manager};

use crate::torrent::engine;
use crate::torrent::state::TorrentState;

use super::domain::DownloadProtocol;
use crate::network::DATA_CLIENT;

/// Resultado de inicio de torrent.
pub struct TorrentStartResult {
    pub info_hash: String,
}

/// Inicia un torrent a partir de magnet o URL `.torrent`.
///
/// Los trackers se obtienen del caché precalentado del engine para evitar
/// latencia de red en el camino crítico. Si el caché está vacío, las funciones
/// del engine los solicitarán de forma síncrona como fallback transparente.
pub async fn start_torrent(
    app: &AppHandle,
    protocol: DownloadProtocol,
    uri: &str,
    destination_dir: &str,
) -> Result<TorrentStartResult, String> {
    let torrent_state = app.state::<TorrentState>();

    // Se extraen la sesión y el caché de trackers en el mismo bloque del mutex
    // para liberar el lock antes de las operaciones de red lentas.
    let (session, cached_trackers) = {
        let engine = torrent_state.engine.lock().await;
        (engine.session(), engine.cached_trackers())
    };

    let (info_hash, name, id) = match protocol {
        DownloadProtocol::TorrentMagnet => {
            engine::add_magnet_to_session(&session, uri, destination_dir, cached_trackers)
                .await
                .map_err(|e| e.to_string())?
        }
        DownloadProtocol::TorrentFile => {
            let response = DATA_CLIENT
                .get(uri)
                .send()
                .await
                .map_err(|e| format!("No se pudo descargar .torrent: {e}"))?;
            if !response.status().is_success() {
                return Err(format!("Descarga .torrent falló: {}", response.status()));
            }
            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("No se pudo leer .torrent: {e}"))?;
            let tmp = std::env::temp_dir().join(format!(
                "savecloud-source-{}.torrent",
                chrono::Utc::now().timestamp_millis()
            ));
            tokio::fs::write(&tmp, &bytes)
                .await
                .map_err(|e| format!("No se pudo escribir .torrent temporal: {e}"))?;
            let tmp_path = tmp.to_string_lossy().to_string();
            engine::add_file_to_session(&session, &tmp_path, destination_dir, cached_trackers)
                .await
                .map_err(|e| e.to_string())?
        }
        _ => return Err("Protocolo torrent inválido".to_string()),
    };

    {
        let mut eng = torrent_state.engine.lock().await;
        eng.register_active(info_hash.clone());
    }

    engine::emit_starting_event(app, &info_hash, &name);
    engine::spawn_progress_monitor(
        session,
        id,
        info_hash.clone(),
        name,
        app.clone(),
        Some(torrent_state.engine.clone()),
    );

    Ok(TorrentStartResult { info_hash })
}
