//! Ejecutor HTTP para jobs de fuentes.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

use crate::network::DATA_CLIENT;

use super::hosters::{self, HosterError};
use super::parser::slugify;

/// Resultado del runner HTTP.
pub struct HttpRunResult {
    pub loaded: u64,
    pub total: u64,
}

/// Descarga una URI HTTP a disco con cancelación cooperativa.
pub async fn run_http_download(
    title: &str,
    destination_dir: &str,
    uri: &str,
    cancel_flag: Arc<AtomicBool>,
    mut on_progress: impl FnMut(u64, u64) -> Result<(), String>,
) -> Result<HttpRunResult, String> {
    let destination = PathBuf::from(destination_dir);
    tokio::fs::create_dir_all(&destination)
        .await
        .map_err(|e| format!("No se pudo crear destino: {e}"))?;

    let resolved = hosters::resolve_download_url(uri)
        .await
        .map_err(|e: HosterError| e.to_user_string())?;
    let effective_uri = resolved.url.as_ref();

    let output = destination.join(build_output_name(title, effective_uri));
    let mut file = tokio::fs::File::create(&output)
        .await
        .map_err(|e| format!("No se pudo crear archivo destino: {e}"))?;

    let mut request = DATA_CLIENT.get(effective_uri);
    if let Some(cookie) = &resolved.cookie {
        request = request.header("Cookie", cookie);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Error HTTP al descargar: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    on_progress(0, total)?;

    let mut loaded = 0_u64;
    let mut last_emit_loaded = 0_u64;
    let mut last_emit_at = Instant::now();
    let mut stream = response.bytes_stream();
    while let Some(next) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            if output.exists() {
                let _ = tokio::fs::remove_file(&output).await;
            }
            return Err("cancelled".to_string());
        }

        let chunk = next.map_err(|e| format!("Error leyendo stream HTTP: {e}"))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Error escribiendo archivo: {e}"))?;
        loaded = loaded.saturating_add(chunk.len() as u64);

        // Throttle de progreso para evitar saturar el frontend con eventos por chunk.
        let advanced_enough = loaded.saturating_sub(last_emit_loaded) >= 256 * 1024;
        let time_elapsed = last_emit_at.elapsed() >= Duration::from_millis(250);
        let reached_end = total > 0 && loaded >= total;
        if advanced_enough || time_elapsed || reached_end {
            on_progress(loaded, total)?;
            last_emit_loaded = loaded;
            last_emit_at = Instant::now();
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("No se pudo flush del archivo: {e}"))?;

    Ok(HttpRunResult { loaded, total })
}

fn build_output_name(title: &str, uri: &str) -> String {
    let extension = reqwest::Url::parse(uri)
        .ok()
        .and_then(|url| {
            Path::new(url.path())
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|v| v.to_ascii_lowercase())
        })
        .filter(|ext| ext.len() <= 8)
        .unwrap_or_else(|| "bin".to_string());
    format!("{}.{}", slugify(title), extension)
}
