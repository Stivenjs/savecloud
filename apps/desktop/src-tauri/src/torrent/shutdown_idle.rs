//! Cierre rápido de la sesión torrent cuando no hay trabajo activo.

use tauri::{AppHandle, Manager};

use crate::setup::TorrentShutdownGuard;
use crate::torrent::state::TorrentState;

/// Si no hay descargas torrent en curso, completa [`TorrentShutdownGuard`]
/// antes de que el coordinador ejecute la fase `TorrentSession`.
///
/// Sin esto el guard puede quedar indefinidamente en `Running` porque solo se
/// completaba cuando un torrent llegaba al 100 % y vaciaba la cola; al cerrar
/// con lista vacía nunca ocurre ese camino y el proceso esperaba el timeout
/// completo de la fase.
pub async fn complete_torrent_shutdown_guard_if_idle(app: &AppHandle) {
    let Some(torrent_state) = app.try_state::<TorrentState>() else {
        return;
    };

    let active_count = {
        let eng = torrent_state.engine.lock().await;
        eng.active_hashes().len()
    };

    if active_count > 0 {
        log::info!(
            "[Shutdown][Torrent] {} descarga(s) torrent activa(s); el guard esperará limpieza de sesión.",
            active_count
        );
        return;
    }

    log::debug!("[Shutdown][Torrent] Sin descargas activas; completando guard de sesión al instante.");

    let Some(guard_state) = app.try_state::<TorrentShutdownGuard>() else {
        return;
    };

    let Ok(mut slot) = guard_state.0.lock() else {
        log::warn!("[Shutdown][Torrent] Mutex de TorrentShutdownGuard envenenado.");
        return;
    };

    if let Some(guard) = slot.take() {
        guard.complete();
    }
}
