//! Ejecutor HTTP para jobs de fuentes.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::header::HeaderMap;
use tokio::io::AsyncWriteExt;

use crate::network::{ensure_download_success, get_with_profile, HOSTER_DOWNLOAD_CLIENT};
use crate::utils::transfer_metrics::TransferSpeedTracker;

use super::hosters::{self, HosterError};
use super::parser::slugify;

/// Tamaño mínimo razonable para un instalador de juego (evita guardar HTML/error como .bin).
const MIN_VALID_DOWNLOAD_BYTES: u64 = 512 * 1024;

/// Bytes descargados entre emisiones de progreso (evita saturar IPC/UI).
const HTTP_PROGRESS_EMIT_BYTES: u64 = 512 * 1024;
/// Intervalo mínimo entre emisiones de progreso.
const HTTP_PROGRESS_EMIT_INTERVAL: Duration = Duration::from_millis(500);

/// Resultado del runner HTTP.
pub struct HttpRunResult {
    pub loaded: u64,
    pub total: u64,
    pub output_file_name: String,
}

/// Descarga una URI HTTP a disco con cancelación cooperativa (sin pausa/resume).
pub async fn run_http_download(
    title: &str,
    destination_dir: &str,
    uri: &str,
    cancel_flag: Arc<AtomicBool>,
    mut on_prepared: impl FnMut(&str) -> Result<(), String>,
    mut on_progress: impl FnMut(u64, u64, u64, Option<u64>) -> Result<(), String>,
) -> Result<HttpRunResult, String> {
    let destination = PathBuf::from(destination_dir);
    tokio::fs::create_dir_all(&destination)
        .await
        .map_err(|e| format!("No se pudo crear destino: {e}"))?;

    let mut speed_tracker = TransferSpeedTracker::new();
    let mut emit_progress = |loaded: u64, total: u64, final_emit: bool| -> Result<(), String> {
        let now = Instant::now();
        let sample = if final_emit {
            speed_tracker.record_final(loaded, total, now)
        } else {
            speed_tracker.record(loaded, total, now)
        };
        on_progress(
            loaded,
            total,
            sample.download_speed_bytes,
            sample.eta_seconds,
        )
    };

    emit_progress(0, 0, false)?;

    let client = HOSTER_DOWNLOAD_CLIENT.clone();
    let resolved = hosters::resolve_download_url_with_client(&client, uri)
        .await
        .map_err(|e: HosterError| e.to_user_string_for_uri(uri))?;
    let effective_uri = resolved.url.as_ref();

    let response = get_with_profile(&client, effective_uri, &resolved.download_profile)
        .await
        .map_err(|e| format!("Error HTTP al descargar: {e}"))?;

    let response = ensure_download_success(response).map_err(|e| e.user_message())?;

    if response_is_html_or_json(response.headers()) {
        return Err(invalid_download_body_message(uri, None));
    }

    let cd_name = content_disposition_filename(response.headers());
    let name_hint = resolved.file_name_hint.or(cd_name);
    let output_file_name = build_output_name(title, effective_uri, name_hint.as_deref());

    on_prepared(&output_file_name)?;
    let output = destination.join(&output_file_name);

    let total = response.content_length().unwrap_or(0);
    let mut file = tokio::fs::File::create(&output)
        .await
        .map_err(|e| format!("No se pudo crear archivo destino: {e}"))?;

    let mut loaded = 0_u64;
    emit_progress(loaded, total, false)?;

    let mut last_emit_loaded = 0_u64;
    let mut last_emit_at = Instant::now();
    let stream_started = Instant::now();
    let mut stream = response.bytes_stream();
    let mut header_checked = false;

    while let Some(next) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = tokio::fs::remove_file(&output).await;
            return Err("stopped_by_user".to_string());
        }

        let chunk = next
            .map_err(|e| stream_read_error_message(e, loaded, total, stream_started.elapsed()))?;

        if !header_checked {
            header_checked = true;
            if looks_like_html_or_json(&chunk) {
                let _ = tokio::fs::remove_file(&output).await;
                let preview = String::from_utf8_lossy(&chunk[..chunk.len().min(512)]);
                return Err(invalid_download_body_message(uri, Some(preview.as_ref())));
            }
        }

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Error escribiendo archivo: {e}"))?;
        loaded = loaded.saturating_add(chunk.len() as u64);

        let bytes_step = loaded.saturating_sub(last_emit_loaded) >= HTTP_PROGRESS_EMIT_BYTES;
        let time_step = last_emit_at.elapsed() >= HTTP_PROGRESS_EMIT_INTERVAL;
        let reached_end = total > 0 && loaded >= total;

        if (bytes_step && time_step) || reached_end {
            emit_progress(loaded, total, false)?;
            last_emit_loaded = loaded;
            last_emit_at = Instant::now();
        }
    }

    if loaded != last_emit_loaded {
        emit_progress(loaded, total, true)?;
    }

    file.flush()
        .await
        .map_err(|e| format!("No se pudo flush del archivo: {e}"))?;

    if loaded < MIN_VALID_DOWNLOAD_BYTES {
        let _ = tokio::fs::remove_file(&output).await;
        let lower_uri = uri.to_ascii_lowercase();
        if lower_uri.contains("vikingfile") || lower_uri.contains("vik1ngfile") {
            return Err(invalid_download_body_message(uri, None));
        }
        return Err(format!(
            "Descarga demasiado pequeña ({loaded} bytes); el enlace no apunta al archivo real"
        ));
    }

    Ok(HttpRunResult {
        loaded,
        total,
        output_file_name,
    })
}

/// Nombre de archivo desde `Content-Disposition` (RFC 5987 / 6266).
fn content_disposition_filename(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get("content-disposition")?.to_str().ok()?;
    let mut plain = None;
    let mut encoded = None;

    for part in raw.split(';').map(str::trim) {
        let lower = part.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("filename*=") {
            let value = &part[part.len() - rest.len()..];
            if let Some(name) = parse_rfc5987_filename(value) {
                encoded = Some(name);
            }
        } else if let Some(rest) = lower.strip_prefix("filename=") {
            let name = part[part.len() - rest.len()..]
                .trim()
                .trim_matches('"')
                .to_string();
            if !name.is_empty() {
                plain = Some(name);
            }
        }
    }

    encoded.or(plain)
}

fn parse_rfc5987_filename(value: &str) -> Option<String> {
    let encoded = value.split('\'').nth(2)?.trim().trim_matches('"');
    if encoded.is_empty() {
        return None;
    }
    let decoded = urlencoding::decode(encoded)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| encoded.to_string());
    if decoded.is_empty() {
        None
    } else {
        Some(decoded)
    }
}

fn response_is_html_or_json(headers: &HeaderMap) -> bool {
    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    content_type.contains("text/html") || content_type.contains("application/json")
}

fn stream_read_error_message(
    err: reqwest::Error,
    loaded: u64,
    total: u64,
    elapsed: Duration,
) -> String {
    if err.is_timeout() {
        return format!(
            "La descarga se cortó por inactividad de red ({loaded} de {total} bytes tras {} s)",
            elapsed.as_secs()
        );
    }
    format!("Error leyendo stream HTTP: {err}")
}

fn looks_like_html_or_json(chunk: &[u8]) -> bool {
    let preview = String::from_utf8_lossy(&chunk[..chunk.len().min(128)]);
    let trimmed = preview.trim_start();
    trimmed.starts_with("<!DOCTYPE")
        || trimmed.starts_with("<html")
        || trimmed.starts_with("<?xml")
        || trimmed.starts_with('{')
        || trimmed.starts_with('[')
}

fn looks_like_cloudflare_challenge(preview: &str) -> bool {
    let lower = preview.to_ascii_lowercase();
    lower.contains("cloudflare")
        || lower.contains("cf-turnstile")
        || lower.contains("challenge-platform")
        || lower.contains("cdn-cgi/challenge")
        || lower.contains("just a moment")
        || lower.contains("attention required")
}

fn invalid_download_body_message(uri: &str, preview: Option<&str>) -> String {
    let lower = uri.to_ascii_lowercase();
    let is_viking = lower.contains("vikingfile") || lower.contains("vik1ngfile");
    let cf = preview.is_some_and(looks_like_cloudflare_challenge);

    if is_viking || cf {
        return "VikingFile devolvió una página de protección (Cloudflare/CAPTCHA), no el instalador. Abre el enlace en el navegador, completa la verificación y descarga manualmente.".into();
    }

    if lower.contains("gofile.io") {
        return hosters::error::gofile_html_instead_of_json();
    }

    "El enlace no devolvió un archivo válido (página web en lugar del instalador)".into()
}

pub fn build_output_name(title: &str, uri: &str, hint: Option<&str>) -> String {
    if let Some(name) = hint {
        let safe = Path::new(name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(name);
        if safe.contains('.') {
            return format!("{}-{}", slugify(title), safe);
        }
    }

    let extension = reqwest::Url::parse(uri)
        .ok()
        .and_then(|url| {
            Path::new(url.path())
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|v| v.to_ascii_lowercase())
        })
        .filter(|ext| !ext.is_empty() && ext.len() <= 8)
        .unwrap_or_else(|| "bin".to_string());
    format!("{}.{}", slugify(title), extension)
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};

    #[test]
    fn content_disposition_prefers_rfc5987_filename() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "content-disposition",
            HeaderValue::from_static(
                "attachment; filename=\"fallback.zip\"; filename*=UTF-8''encoded%20name.zip",
            ),
        );
        assert_eq!(
            content_disposition_filename(&headers).as_deref(),
            Some("encoded name.zip")
        );
    }

    #[test]
    fn build_output_name_uses_disposition_hint() {
        let name = build_output_name(
            "Sons Of The Forest",
            "https://cdn.example/download/abc?sig=1",
            Some("Sons Of The Forest - SteamGG.NET.zip"),
        );
        assert!(name.ends_with("Sons Of The Forest - SteamGG.NET.zip"));
        assert!(!name.ends_with(".bin"));
    }
}
