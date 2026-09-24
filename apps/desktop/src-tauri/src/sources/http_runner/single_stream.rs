//! Motor de descarga en stream secuencial único.
//!
//! Actúa como fallback transparente cuando el servidor hoster no soporta rangos HTTP
//! (`Accept-Ranges: bytes`), cuando el archivo es inferior a 20 MB, o cuando no se
//! conoce la longitud total de antemano. Soporta reanudación desde el byte existente.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

use crate::network::{apply_profile, DownloadProfile};
use super::segments::{HTTP_PROGRESS_EMIT_BYTES, HTTP_PROGRESS_EMIT_INTERVAL};
use super::validation::{invalid_download_body_message, looks_like_html_or_json, stream_read_error_message};

/// Ejecuta la descarga en un único flujo continuo HTTP con soporte cooperativo de pausa.
pub async fn run_single_stream_download<F>(
    client: &reqwest::Client,
    effective_uri: &str,
    profile: &DownloadProfile,
    initial_response: Option<reqwest::Response>,
    part_path: &Path,
    total: u64,
    accept_ranges: bool,
    cancel_flag: Arc<AtomicBool>,
    pause_flag: Arc<AtomicBool>,
    mut emit_progress: F,
) -> Result<u64, String>
where
    F: FnMut(u64, u64, bool) -> Result<(), String>,
{
    let existing_len = if part_path.exists() {
        tokio::fs::metadata(part_path)
            .await
            .map(|m| m.len())
            .unwrap_or(0)
    } else {
        0
    };

    let (response, mut file, mut loaded) =
        if existing_len > 0 && accept_ranges && (total == 0 || existing_len < total) {
            drop(initial_response);
            let range = format!("bytes={existing_len}-");
            let req = client.get(effective_uri).header("Range", range);
            let req = apply_profile(req, profile);
            let res = req
                .send()
                .await
                .map_err(|e| format!("Error reanudando descarga: {e}"))?;

            if res.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                let file = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(part_path)
                    .await
                    .map_err(|e| format!("No se pudo abrir archivo para reanudar: {e}"))?;
                (res, file, existing_len)
            } else {
                let file = tokio::fs::File::create(part_path)
                    .await
                    .map_err(|e| format!("No se pudo crear archivo destino: {e}"))?;
                (res, file, 0)
            }
        } else {
            let res = match initial_response {
                Some(r) => r,
                None => {
                    let req = apply_profile(client.get(effective_uri), profile);
                    req.send()
                        .await
                        .map_err(|e| format!("Error iniciando stream: {e}"))?
                }
            };
            let file = tokio::fs::File::create(part_path)
                .await
                .map_err(|e| format!("No se pudo crear archivo destino: {e}"))?;
            (res, file, 0)
        };

    emit_progress(loaded, total, false)?;

    let mut last_emit_loaded = loaded;
    let mut last_emit_at = Instant::now();
    let stream_started = Instant::now();
    let mut stream = response.bytes_stream();
    let mut header_checked = false;
    let mut retries = 0usize;
    const MAX_RETRIES: usize = 6;

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = tokio::fs::remove_file(part_path).await;
            return Err("stopped_by_user".to_string());
        }

        if pause_flag.load(Ordering::Relaxed) {
            let _ = file.flush().await;
            return Err("paused_by_user".to_string());
        }

        let mut stream_error = None;

        while let Some(next) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) {
                let _ = tokio::fs::remove_file(part_path).await;
                return Err("stopped_by_user".to_string());
            }

            if pause_flag.load(Ordering::Relaxed) {
                let _ = file.flush().await;
                return Err("paused_by_user".to_string());
            }

            match next {
                Ok(chunk) => {
                    // Validar en memoria RAM que los primeros bytes no sean una página web de error
                    if !header_checked && loaded == 0 {
                        header_checked = true;
                        if looks_like_html_or_json(&chunk) {
                            drop(file);
                            let _ = tokio::fs::remove_file(part_path).await;
                            let preview = String::from_utf8_lossy(&chunk[..chunk.len().min(512)]);
                            return Err(invalid_download_body_message(
                                effective_uri,
                                Some(preview.as_ref()),
                            ));
                        }
                    }

                    if let Err(e) = file.write_all(&chunk).await {
                        return Err(format!("Error escribiendo archivo: {e}"));
                    }
                    loaded = loaded.saturating_add(chunk.len() as u64);

                    let bytes_step = loaded.saturating_sub(last_emit_loaded) >= HTTP_PROGRESS_EMIT_BYTES;
                    let time_step = last_emit_at.elapsed() >= HTTP_PROGRESS_EMIT_INTERVAL;
                    let reached_end = total > 0 && loaded >= total;

                    if (bytes_step && time_step) || reached_end {
                        emit_progress(loaded, total, false)?;
                        last_emit_loaded = loaded;
                        last_emit_at = Instant::now();
                    }

                    retries = 0;
                }
                Err(e) => {
                    stream_error = Some(e);
                    break;
                }
            }
        }

        if cancel_flag.load(Ordering::Relaxed) {
            let _ = tokio::fs::remove_file(part_path).await;
            return Err("stopped_by_user".to_string());
        }

        if pause_flag.load(Ordering::Relaxed) {
            let _ = file.flush().await;
            return Err("paused_by_user".to_string());
        }

        if let Some(e) = stream_error {
            let _ = file.flush().await;
            if accept_ranges && (total == 0 || loaded < total) && retries < MAX_RETRIES {
                retries += 1;
                let backoff = Duration::from_millis(500 * (1 << retries.min(4)));
                log::warn!(
                    "Corte en stream único ({e}), reanudando desde byte {loaded} ({retries}/{MAX_RETRIES}) en {backoff:?}..."
                );
                tokio::time::sleep(backoff).await;

                let range = format!("bytes={loaded}-");
                let req = client
                    .get(effective_uri)
                    .header("Range", range)
                    .header("Accept-Encoding", "identity");
                let req = apply_profile(req, profile);
                match req.send().await {
                    Ok(res) if res.status().is_success() || res.status() == reqwest::StatusCode::PARTIAL_CONTENT => {
                        stream = res.bytes_stream();
                        continue;
                    }
                    _ => continue,
                }
            }
            return Err(stream_read_error_message(e, loaded, total, stream_started.elapsed()));
        }

        if accept_ranges && total > 0 && loaded < total && retries < MAX_RETRIES {
            let _ = file.flush().await;
            retries += 1;
            log::info!(
                "Stream único cerrado por el servidor en byte {loaded}/{total}, reconectando ({retries}/{MAX_RETRIES})..."
            );
            tokio::time::sleep(Duration::from_millis(300)).await;

            let range = format!("bytes={loaded}-");
            let req = client
                .get(effective_uri)
                .header("Range", range)
                .header("Accept-Encoding", "identity");
            let req = apply_profile(req, profile);
            match req.send().await {
                Ok(res) if res.status().is_success() || res.status() == reqwest::StatusCode::PARTIAL_CONTENT => {
                    stream = res.bytes_stream();
                    continue;
                }
                _ => continue,
            }
        }

        break;
    }

    if loaded != last_emit_loaded {
        emit_progress(loaded, total, true)?;
    }

    file.flush()
        .await
        .map_err(|e| format!("No se pudo flush del archivo: {e}"))?;
    drop(file);

    Ok(loaded)
}
