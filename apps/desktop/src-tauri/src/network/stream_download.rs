//! Descarga HTTP por streaming reutilizable (hosters, LAN peer, etc.).

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use tokio::io::AsyncWriteExt;

use crate::network::ensure_download_success;
use crate::utils::transfer_metrics::TransferSpeedTracker;

/// Coincide con [`crate::peer_lan::checkpoint::PAUSED_BY_USER`].
pub const STREAM_PAUSED_BY_USER: &str = "paused_by_user";

/// Bytes entre emisiones de progreso.
pub const STREAM_PROGRESS_EMIT_BYTES: u64 = 512 * 1024;
/// Intervalo mínimo entre emisiones.
pub const STREAM_PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(500);

pub struct StreamDownloadResult {
    pub loaded: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct GlobalDownloadProgress {
    pub loaded_offset: u64,
    pub total_bytes: u64,
}

#[expect(
    clippy::too_many_arguments,
    reason = "Parámetros requeridos para descarga de stream con trackers y callbacks de progreso"
)]
pub async fn stream_url_to_file(
    client: &reqwest::Client,
    uri: &str,
    output_path: &Path,
    total_hint: u64,
    auth_bearer: Option<&str>,
    cancel_flag: Arc<AtomicBool>,
    pause_flag: Option<Arc<AtomicBool>>,
    speed_tracker: &mut TransferSpeedTracker,
    global: GlobalDownloadProgress,
    mut on_progress: impl FnMut(u64, u64, u64, Option<u64>) -> Result<(), String>,
) -> Result<StreamDownloadResult, String> {
    if let Some(parent) = output_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("No se pudo crear directorio: {e}"))?;
    }

    let mut headers = HeaderMap::new();
    if let Some(token) = auth_bearer {
        let value = format!("Bearer {token}");
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&value).map_err(|e| e.to_string())?,
        );
    }

    let mut req = client.get(uri);
    for (k, v) in headers.iter() {
        req = req.header(k, v);
    }
    let response = req.send().await.map_err(|e| format!("Error HTTP: {e}"))?;
    let response = ensure_download_success(response).map_err(|e| e.user_message())?;

    let file_total = if total_hint > 0 {
        total_hint
    } else {
        response.content_length().unwrap_or(0)
    };

    let mut file = tokio::fs::File::create(output_path)
        .await
        .map_err(|e| format!("No se pudo crear archivo: {e}"))?;

    let global_total = if global.total_bytes > 0 {
        global.total_bytes
    } else {
        file_total
    };

    let mut emit_progress = |file_loaded: u64, final_emit: bool| -> Result<(), String> {
        let global_loaded = global.loaded_offset.saturating_add(file_loaded);
        let now = Instant::now();
        let sample = if final_emit {
            speed_tracker.record_final(global_loaded, global_total, now)
        } else {
            speed_tracker.record(global_loaded, global_total, now)
        };
        on_progress(
            file_loaded,
            file_total,
            sample.download_speed_bytes,
            sample.eta_seconds,
        )
    };

    let mut loaded = 0_u64;
    emit_progress(loaded, false)?;

    let mut last_emit_loaded = 0_u64;
    let mut last_emit_at = Instant::now();
    let mut stream = response.bytes_stream();

    while let Some(next) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = tokio::fs::remove_file(output_path).await;
            return Err("stopped_by_user".to_string());
        }
        if pause_flag
            .as_ref()
            .is_some_and(|f| f.load(Ordering::Relaxed))
        {
            return Err(STREAM_PAUSED_BY_USER.to_string());
        }
        let chunk = next.map_err(|e| format!("Error leyendo stream: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Error escribiendo: {e}"))?;
        loaded = loaded.saturating_add(chunk.len() as u64);

        let bytes_step = loaded.saturating_sub(last_emit_loaded) >= STREAM_PROGRESS_EMIT_BYTES;
        let time_step = last_emit_at.elapsed() >= STREAM_PROGRESS_EMIT_INTERVAL;
        let reached_end = file_total > 0 && loaded >= file_total;
        if (bytes_step && time_step) || reached_end {
            emit_progress(loaded, false)?;
            last_emit_loaded = loaded;
            last_emit_at = Instant::now();
        }
    }

    if loaded != last_emit_loaded {
        emit_progress(loaded, true)?;
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush falló: {e}"))?;

    Ok(StreamDownloadResult { loaded })
}
