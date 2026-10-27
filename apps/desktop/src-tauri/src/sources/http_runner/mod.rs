//! Ejecutor HTTP acelerado para jobs de fuentes (multi-segmento y pause/resume).
//!
//! Coordina la resolución de URLs mediante clientes y perfiles específicos por hoster,
//! particiona archivos grandes en hasta 4 rangos, reduce la concurrencia ante límites del
//! hoster y mantiene checkpoints compatibles con pausa y reanudación.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use base64::Engine;
use sha2::{Digest, Sha256};
use tauri::AppHandle;
use tokio::io::AsyncReadExt;

use super::hosters::{self, HosterError};
use crate::network::{ensure_download_success, get_hoster_download_client, get_with_profile};
use crate::utils::transfer_metrics::TransferSpeedTracker;

pub mod io;
pub mod naming;
pub mod retry;
pub mod segments;
pub mod single_stream;
pub mod validation;

pub use naming::build_output_name;

use io::safe_rename_with_retry;
use naming::content_disposition_filename;
use segments::{run_multi_segment_download, PARALLELISM_REDUCE_ERROR, RANGE_UNSUPPORTED_ERROR};
use single_stream::run_single_stream_download;
use validation::{invalid_download_body_message, response_is_html_or_json};

/// Tamaño mínimo razonable para un instalador de juego (512 KB).
/// Evita guardar accidentalmente páginas HTML o respuestas vacías de error como `.bin`.
pub const MIN_VALID_DOWNLOAD_BYTES: u64 = 512 * 1024;

/// Umbral mínimo de tamaño de archivo para activar el acelerador multi-segmento paralelo (20 MB).
pub const MIN_MULTI_SEGMENT_BYTES: u64 = 20 * 1024 * 1024;

/// Resultado final de la ejecución de una descarga HTTP.
#[derive(Debug, Clone)]
pub struct HttpRunResult {
    pub loaded: u64,
    pub total: u64,
    pub output_file_name: String,
}

/// Descarga una URI HTTP a disco con aceleración multi-hilo, pausa y reanudación (resume).
pub async fn run_http_download(
    app: &AppHandle,
    title: &str,
    destination_dir: &str,
    uri: &str,
    cancel_flag: Arc<AtomicBool>,
    pause_flag: Arc<AtomicBool>,
    mut on_prepared: impl FnMut(&str) -> Result<(), String>,
    mut on_progress: impl FnMut(u64, u64, u64, Option<u64>) -> Result<(), String>,
    on_status_detail: Arc<dyn Fn(Option<String>) -> Result<(), String> + Send + Sync>,
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

    let client = get_hoster_download_client();

    let on_status_detail_clone = on_status_detail.clone();
    let status_cb: crate::sources::commands::fetch::CrawlerEventCallback =
        Arc::new(move |stage: &str| {
            let _ = on_status_detail_clone(Some(stage.to_string()));
        });

    let resolved = hosters::resolve_download_url_with_client_and_progress(
        Some(app),
        &client,
        uri,
        Some(cancel_flag.clone()),
        Some(status_cb),
    )
    .await
    .map_err(|e: HosterError| e.to_user_string_for_uri(uri))?;

    let _ = on_status_detail(None);

    let effective_uri = resolved.url.as_ref();
    let profile = resolved.download_profile;

    let initial_response = get_with_profile(&client, effective_uri, &profile)
        .await
        .map_err(|e| format!("Error HTTP al conectar con descarga: {e}"))?;

    let initial_response =
        ensure_download_success(initial_response).map_err(|e| e.user_message())?;

    if response_is_html_or_json(initial_response.headers()) {
        return Err(invalid_download_body_message(uri, None));
    }

    let cd_name = content_disposition_filename(initial_response.headers());
    let name_hint = resolved.file_name_hint.or(cd_name);
    let output_file_name = build_output_name(title, effective_uri, name_hint.as_deref());

    on_prepared(&output_file_name)?;
    let output = destination.join(&output_file_name);
    let part_path = destination.join(format!("{output_file_name}.part"));
    let meta_path = destination.join(format!("{output_file_name}.part.meta"));
    let single_meta_path = destination.join(format!("{output_file_name}.part.stream.meta"));

    let total = initial_response.content_length().unwrap_or(0);
    let validator = download_validator(initial_response.headers());
    let mut expected_sha256 = sha256_digest(initial_response.headers())?;
    let accept_ranges = initial_response
        .headers()
        .get("accept-ranges")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_ascii_lowercase())
        .unwrap_or_default()
        == "bytes"
        || initial_response.status() == reqwest::StatusCode::PARTIAL_CONTENT;

    let final_loaded = if accept_ranges && total >= MIN_MULTI_SEGMENT_BYTES {
        drop(initial_response);
        match run_multi_segment_download(
            &client,
            effective_uri,
            &profile,
            &part_path,
            &meta_path,
            total,
            validator.clone(),
            cancel_flag.clone(),
            pause_flag.clone(),
            &mut emit_progress,
        )
        .await
        {
            Ok(loaded) => loaded,
            Err(error)
                if error.starts_with(RANGE_UNSUPPORTED_ERROR)
                    || error.starts_with(PARALLELISM_REDUCE_ERROR) =>
            {
                let _ = tokio::fs::remove_file(&part_path).await;
                let _ = tokio::fs::remove_file(&meta_path).await;
                let response = get_with_profile(&client, effective_uri, &profile)
                    .await
                    .map_err(|error| format!("Error al reiniciar descarga HTTP: {error}"))?;
                let response =
                    ensure_download_success(response).map_err(|error| error.user_message())?;
                if response.status() != reqwest::StatusCode::OK {
                    return Err(format!(
                        "El hoster no entregó un stream completo para el fallback (HTTP {})",
                        response.status()
                    ));
                }
                if response
                    .content_length()
                    .is_some_and(|length| length != total)
                {
                    return Err("El tamaño remoto cambió al reiniciar la descarga".to_string());
                }
                let fallback_validator = download_validator(response.headers());
                if validator.is_some() && fallback_validator != validator {
                    return Err("El archivo remoto cambió durante el fallback HTTP".to_string());
                }
                if let Some(digest) = sha256_digest(response.headers())? {
                    expected_sha256 = Some(digest);
                }
                if response_is_html_or_json(response.headers()) {
                    return Err(invalid_download_body_message(uri, None));
                }
                run_single_stream_download(
                    &client,
                    effective_uri,
                    &profile,
                    Some(response),
                    &part_path,
                    &single_meta_path,
                    total,
                    validator.clone(),
                    true,
                    cancel_flag.clone(),
                    pause_flag.clone(),
                    &mut emit_progress,
                )
                .await?
            }
            Err(error) => return Err(error),
        }
    } else {
        run_single_stream_download(
            &client,
            effective_uri,
            &profile,
            Some(initial_response),
            &part_path,
            &single_meta_path,
            total,
            validator,
            accept_ranges,
            cancel_flag.clone(),
            pause_flag.clone(),
            &mut emit_progress,
        )
        .await?
    };

    if final_loaded < MIN_VALID_DOWNLOAD_BYTES {
        let _ = tokio::fs::remove_file(&part_path).await;
        let _ = tokio::fs::remove_file(&meta_path).await;
        let _ = tokio::fs::remove_file(&single_meta_path).await;
        let lower_uri = uri.to_ascii_lowercase();
        if lower_uri.contains("vikingfile") || lower_uri.contains("vik1ngfile") {
            return Err(invalid_download_body_message(uri, None));
        }
        return Err(format!(
            "Descarga demasiado pequeña ({final_loaded} bytes); el enlace no apunta al archivo real"
        ));
    }

    if let Some(expected) = expected_sha256 {
        let actual = sha256_file(&part_path).await?;
        if actual != expected {
            let _ = tokio::fs::remove_file(&part_path).await;
            let _ = tokio::fs::remove_file(&meta_path).await;
            let _ = tokio::fs::remove_file(&single_meta_path).await;
            return Err("El checksum SHA-256 del archivo descargado no coincide".to_string());
        }
    }

    safe_rename_with_retry(&part_path, &output)
        .await
        .map_err(|e| format!("No se pudo renombrar archivo final: {e}"))?;

    let _ = tokio::fs::remove_file(&meta_path).await;
    let _ = tokio::fs::remove_file(&single_meta_path).await;

    Ok(HttpRunResult {
        loaded: final_loaded,
        total: if total > 0 { total } else { final_loaded },
        output_file_name,
    })
}

fn download_validator(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get(reqwest::header::ETAG)
        .and_then(|value| value.to_str().ok())
        .filter(|etag| !etag.trim_start().starts_with("W/"))
        .or_else(|| {
            headers
                .get(reqwest::header::LAST_MODIFIED)
                .and_then(|value| value.to_str().ok())
        })
        .map(str::to_owned)
}

fn sha256_digest(headers: &reqwest::header::HeaderMap) -> Result<Option<[u8; 32]>, String> {
    for header_name in ["content-digest", "digest"] {
        let Some(header_value) = headers.get(header_name) else {
            continue;
        };
        let value = header_value
            .to_str()
            .map_err(|error| format!("Cabecera de checksum inválida: {error}"))?;
        for entry in value.split(',') {
            let Some((algorithm, encoded)) = entry.trim().split_once('=') else {
                continue;
            };
            if !algorithm.trim().eq_ignore_ascii_case("sha-256") {
                continue;
            }
            let encoded = encoded.trim().trim_matches('"').trim_matches(':');
            let digest = base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .map_err(|error| format!("Checksum SHA-256 inválido: {error}"))?;
            let digest: [u8; 32] = digest
                .try_into()
                .map_err(|_| "El checksum SHA-256 tiene una longitud inválida".to_string())?;
            return Ok(Some(digest));
        }
    }
    Ok(None)
}

async fn sha256_file(path: &std::path::Path) -> Result<[u8; 32], String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("No se pudo abrir el archivo para verificarlo: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 1024 * 1024];

    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("No se pudo leer el archivo para verificarlo: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }

    Ok(hasher.finalize().into())
}
