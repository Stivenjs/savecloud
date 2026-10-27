//! Motor de descarga en stream secuencial único.
//!
//! Actúa como fallback transparente cuando el servidor hoster no soporta rangos HTTP
//! (`Accept-Ranges: bytes`), cuando el archivo es inferior a 20 MB, o cuando no se
//! conoce la longitud total de antemano. Soporta reanudación desde el byte existente.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use futures_util::StreamExt;
use reqwest::Response;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncSeekExt, AsyncWriteExt};

use super::io::write_json_atomically;
use super::retry::{retry_delay, wait_for_retry};
use super::segments::{HTTP_PROGRESS_EMIT_BYTES, HTTP_PROGRESS_EMIT_INTERVAL};
use super::validation::{
    invalid_download_body_message, looks_like_html_or_json, stream_read_error_message,
    validate_resume_response,
};
use crate::network::{apply_profile, ensure_download_success, DownloadProfile};

#[derive(Serialize, Deserialize)]
struct SingleStreamMeta {
    total: u64,
    validator: Option<String>,
}

/// Ejecuta la descarga en un único flujo continuo HTTP con soporte cooperativo de pausa.
pub async fn run_single_stream_download<F>(
    client: &reqwest::Client,
    effective_uri: &str,
    profile: &DownloadProfile,
    initial_response: Option<reqwest::Response>,
    part_path: &Path,
    checkpoint_path: &Path,
    total: u64,
    validator: Option<String>,
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

    let saved_validator = tokio::fs::read(checkpoint_path)
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<SingleStreamMeta>(&bytes).ok())
        .filter(|meta| meta.total == total)
        .and_then(|meta| meta.validator);
    let can_resume = existing_len > 0
        && accept_ranges
        && validator
            .as_ref()
            .is_some_and(|current| saved_validator.as_ref() == Some(current))
        && (total == 0 || existing_len < total);

    let (response, mut file, mut loaded) = if can_resume {
        drop(initial_response);
        let res = request_resume(
            client,
            effective_uri,
            profile,
            existing_len,
            total,
            validator.as_deref(),
            &cancel_flag,
            &pause_flag,
        )
        .await;
        let res = match res {
            Ok(response) => response,
            Err(error) if error == "stopped_by_user" => {
                remove_partial_download(part_path, checkpoint_path).await;
                return Err(error);
            }
            Err(error) => return Err(error),
        };

        if res.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            validate_resume_response(&res, existing_len, total)?;
            let file = tokio::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(part_path)
                .await
                .map_err(|e| format!("No se pudo abrir archivo para reanudar: {e}"))?;
            (res, file, existing_len)
        } else {
            let res = validate_full_restart(res, total, validator.as_deref())?;
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

    if !can_resume {
        let checkpoint = SingleStreamMeta {
            total,
            validator: validator.clone(),
        };
        write_json_atomically(checkpoint_path, &checkpoint)
            .await
            .map_err(|error| format!("No se pudo guardar el checkpoint HTTP: {error}"))?;
    }

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
            drop(file);
            let _ = tokio::fs::remove_file(part_path).await;
            let _ = tokio::fs::remove_file(checkpoint_path).await;
            return Err("stopped_by_user".to_string());
        }

        if pause_flag.load(Ordering::Relaxed) {
            file.sync_data()
                .await
                .map_err(|error| format!("No se pudo sincronizar la descarga pausada: {error}"))?;
            return Err("paused_by_user".to_string());
        }

        let mut stream_error = None;

        while let Some(next) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) {
                drop(file);
                let _ = tokio::fs::remove_file(part_path).await;
                let _ = tokio::fs::remove_file(checkpoint_path).await;
                return Err("stopped_by_user".to_string());
            }

            if pause_flag.load(Ordering::Relaxed) {
                file.sync_data().await.map_err(|error| {
                    format!("No se pudo sincronizar la descarga pausada: {error}")
                })?;
                return Err("paused_by_user".to_string());
            }

            match next {
                Ok(chunk) => {
                    if total > 0 && loaded.saturating_add(chunk.len() as u64) > total {
                        return Err(format!(
                            "El servidor envió más datos que el tamaño anunciado ({total} bytes)"
                        ));
                    }

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

                    let bytes_step =
                        loaded.saturating_sub(last_emit_loaded) >= HTTP_PROGRESS_EMIT_BYTES;
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
            drop(file);
            let _ = tokio::fs::remove_file(part_path).await;
            let _ = tokio::fs::remove_file(checkpoint_path).await;
            return Err("stopped_by_user".to_string());
        }

        if pause_flag.load(Ordering::Relaxed) {
            file.sync_data()
                .await
                .map_err(|error| format!("No se pudo sincronizar la descarga pausada: {error}"))?;
            return Err("paused_by_user".to_string());
        }

        if let Some(e) = stream_error {
            let _ = file.flush().await;
            if accept_ranges && (total == 0 || loaded < total) && retries < MAX_RETRIES {
                retries += 1;
                let backoff = retry_delay(retries, None);
                log::warn!(
                    "Corte en stream único ({e}), reanudando desde byte {loaded} ({retries}/{MAX_RETRIES}) en {backoff:?}..."
                );
                wait_for_retry(backoff, &cancel_flag, &pause_flag).await?;

                let res = request_resume(
                    client,
                    effective_uri,
                    profile,
                    loaded,
                    total,
                    validator.as_deref(),
                    &cancel_flag,
                    &pause_flag,
                )
                .await;
                let res = match res {
                    Ok(response) => response,
                    Err(error) if error == "stopped_by_user" => {
                        drop(file);
                        remove_partial_download(part_path, checkpoint_path).await;
                        return Err(error);
                    }
                    Err(error) => return Err(error),
                };
                if res.status() == reqwest::StatusCode::OK {
                    let res = validate_full_restart(res, total, validator.as_deref())?;
                    file.set_len(0)
                        .await
                        .map_err(|error| format!("No se pudo reiniciar el archivo: {error}"))?;
                    file.seek(std::io::SeekFrom::Start(0))
                        .await
                        .map_err(|error| format!("No se pudo reiniciar el archivo: {error}"))?;
                    loaded = 0;
                    last_emit_loaded = 0;
                    last_emit_at = Instant::now();
                    stream = res.bytes_stream();
                    header_checked = false;
                    continue;
                }
                stream = res.bytes_stream();
                continue;
            }
            return Err(stream_read_error_message(
                e,
                loaded,
                total,
                stream_started.elapsed(),
            ));
        }

        if accept_ranges && total > 0 && loaded < total && retries < MAX_RETRIES {
            let _ = file.flush().await;
            retries += 1;
            log::info!(
                "Stream único cerrado por el servidor en byte {loaded}/{total}, reconectando ({retries}/{MAX_RETRIES})..."
            );
            wait_for_retry(retry_delay(retries, None), &cancel_flag, &pause_flag).await?;

            let res = request_resume(
                client,
                effective_uri,
                profile,
                loaded,
                total,
                validator.as_deref(),
                &cancel_flag,
                &pause_flag,
            )
            .await;
            let res = match res {
                Ok(response) => response,
                Err(error) if error == "stopped_by_user" => {
                    drop(file);
                    remove_partial_download(part_path, checkpoint_path).await;
                    return Err(error);
                }
                Err(error) => return Err(error),
            };
            if res.status() == reqwest::StatusCode::OK {
                let res = validate_full_restart(res, total, validator.as_deref())?;
                file.set_len(0)
                    .await
                    .map_err(|error| format!("No se pudo reiniciar el archivo: {error}"))?;
                file.seek(std::io::SeekFrom::Start(0))
                    .await
                    .map_err(|error| format!("No se pudo reiniciar el archivo: {error}"))?;
                loaded = 0;
                last_emit_loaded = 0;
                last_emit_at = Instant::now();
                stream = res.bytes_stream();
                header_checked = false;
                continue;
            }
            stream = res.bytes_stream();
            continue;
        }

        break;
    }

    if total > 0 && loaded != total {
        return Err(format!(
            "Descarga HTTP incompleta: {loaded} de {total} bytes"
        ));
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

async fn request_resume(
    client: &reqwest::Client,
    uri: &str,
    profile: &DownloadProfile,
    start: u64,
    total: u64,
    validator: Option<&str>,
    cancel_flag: &Arc<AtomicBool>,
    pause_flag: &Arc<AtomicBool>,
) -> Result<Response, String> {
    const MAX_REQUEST_RETRIES: usize = 6;

    for attempt in 1..=MAX_REQUEST_RETRIES {
        let mut request = client
            .get(uri)
            .header("Range", format!("bytes={start}-"))
            .header("Accept-Encoding", "identity");
        if let Some(value) = validator {
            request = request.header(reqwest::header::IF_RANGE, value);
        }
        let request = apply_profile(request, profile);

        match request.send().await {
            Ok(response)
                if response.status() == reqwest::StatusCode::PARTIAL_CONTENT
                    || response.status() == reqwest::StatusCode::OK =>
            {
                if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
                    validate_resume_response(&response, start, total)?;
                }
                return Ok(response);
            }
            Ok(response) => {
                let status = response.status();
                let retryable = status == reqwest::StatusCode::REQUEST_TIMEOUT
                    || status == reqwest::StatusCode::TOO_MANY_REQUESTS
                    || status.is_server_error();
                if !retryable || attempt == MAX_REQUEST_RETRIES {
                    return Err(format!("No se pudo reanudar la descarga: HTTP {status}"));
                }
                let delay = retry_delay(attempt, Some(response.headers()));
                drop(response);
                wait_for_retry(delay, cancel_flag, pause_flag).await?;
            }
            Err(error) => {
                if attempt == MAX_REQUEST_RETRIES {
                    return Err(format!("Error reanudando descarga: {error}"));
                }
                let delay = retry_delay(attempt, None);
                wait_for_retry(delay, cancel_flag, pause_flag).await?;
            }
        }
    }

    Err("Se agotaron los intentos para reanudar la descarga".to_string())
}

async fn remove_partial_download(part_path: &Path, checkpoint_path: &Path) {
    let _ = tokio::fs::remove_file(part_path).await;
    let _ = tokio::fs::remove_file(checkpoint_path).await;
}

fn validate_full_restart(
    response: Response,
    total: u64,
    validator: Option<&str>,
) -> Result<Response, String> {
    let response = ensure_download_success(response).map_err(|error| error.user_message())?;
    if let Some(expected_validator) = validator {
        let actual_validator = super::download_validator(response.headers());
        if actual_validator.as_deref() != Some(expected_validator) {
            return Err(
                "El archivo remoto cambió durante la descarga; se debe iniciar de nuevo"
                    .to_string(),
            );
        }
    }
    if total > 0
        && response
            .content_length()
            .is_some_and(|length| length != total)
    {
        return Err("El tamaño remoto cambió al reanudar la descarga".to_string());
    }
    Ok(response)
}
