//! Ejecutor HTTP acelerado para jobs de fuentes (multi-segmento y pause/resume).
//!
//! Coordina la resolución de URLs mediante clientes y perfiles específicos por hoster,
//! particiona automáticamente archivos de juegos en 4 conexiones paralelas si el servidor
//! soporta rangos (`Range: bytes`), gestiona metadatos `.part.meta` para pausar y reanudar
//! de forma determinista, y asegura escrituras atómicas a disco tolerantes a antivirus.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use tauri::AppHandle;

use super::hosters::{self, HosterError};
use crate::network::{ensure_download_success, get_hoster_download_client, get_with_profile};
use crate::utils::transfer_metrics::TransferSpeedTracker;

pub mod io;
pub mod naming;
pub mod segments;
pub mod single_stream;
pub mod validation;

pub use naming::build_output_name;

use io::safe_rename_with_retry;
use naming::content_disposition_filename;
use segments::run_multi_segment_download;
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

    let total = initial_response.content_length().unwrap_or(0);
    let accept_ranges = initial_response
        .headers()
        .get("accept-ranges")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.to_ascii_lowercase())
        .unwrap_or_default()
        == "bytes"
        || initial_response.status() == reqwest::StatusCode::PARTIAL_CONTENT;

    // Si el archivo final ya existe con el tamaño idéntico al reportado por el servidor, completar de inmediato
    if output.exists() && total > 0 {
        if let Ok(meta) = tokio::fs::metadata(&output).await {
            if meta.len() == total {
                emit_progress(total, total, true)?;
                return Ok(HttpRunResult {
                    loaded: total,
                    total,
                    output_file_name,
                });
            }
        }
    }

    let final_loaded = if accept_ranges && total >= MIN_MULTI_SEGMENT_BYTES {
        drop(initial_response);
        run_multi_segment_download(
            &client,
            effective_uri,
            &profile,
            &part_path,
            &meta_path,
            total,
            cancel_flag.clone(),
            pause_flag.clone(),
            &mut emit_progress,
        )
        .await?
    } else {
        run_single_stream_download(
            &client,
            effective_uri,
            &profile,
            Some(initial_response),
            &part_path,
            total,
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
        let lower_uri = uri.to_ascii_lowercase();
        if lower_uri.contains("vikingfile") || lower_uri.contains("vik1ngfile") {
            return Err(invalid_download_body_message(uri, None));
        }
        return Err(format!(
            "Descarga demasiado pequeña ({final_loaded} bytes); el enlace no apunta al archivo real"
        ));
    }

    safe_rename_with_retry(&part_path, &output)
        .await
        .map_err(|e| format!("No se pudo renombrar archivo final: {e}"))?;

    let _ = tokio::fs::remove_file(&meta_path).await;

    Ok(HttpRunResult {
        loaded: final_loaded,
        total: if total > 0 { total } else { final_loaded },
        output_file_name,
    })
}
