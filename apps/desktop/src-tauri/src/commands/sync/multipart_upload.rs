//! Subida multipart de archivos grandes a S3 con soporte de pausa y cancelación.
//!
//! Este módulo implementa el flujo completo de multipart upload:
//!
//! 1. Inicialización de la subida.
//! 2. Obtención de URLs prefirmadas por partes (en lote).
//! 3. Transferencia de cada parte mediante solicitudes PUT.
//! 4. Finalización de la subida o abort en caso de cancelación.
//!
//! Permite pausar la operación persistiendo el estado en disco,
//! facilitando su reanudación posterior.
//!
//! # Fiabilidad
//!
//! Para mejorar la resiliencia del proceso:
//!
//! - Las URLs prefirmadas se generan en lote para reducir la carga sobre el backend.
//! - Se aplican reintentos con backoff en todas las fases críticas del flujo.
//! - Se configuran timeouts de conexión y de request en el cliente HTTP.

use std::collections::HashSet;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};

use super::api;
use super::events::emit_sync_upload_progress;
use super::models::{SyncOperationStrategy, SyncProgressPayload};
use crate::commands::logs::sync_logger;
use crate::network::DATA_CLIENT;
use futures_util::stream::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

pub const PAUSED_ERR_MSG: &str = "PAUSED";
const PAUSED_STATE_FILE: &str = "paused_upload.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PausedUploadState {
    pub upload_id: String,
    pub key: String,
    pub game_id: String,
    pub filename: String,
    pub absolute_path: String,
    pub total_size: u64,
    pub completed_parts: Vec<CompletedPartState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedPartState {
    pub part_number: u32,
    pub etag: String,
}

fn paused_state_path() -> Option<std::path::PathBuf> {
    crate::config::config_dir().map(|d| d.join(PAUSED_STATE_FILE))
}

fn save_paused_state(state: &PausedUploadState) -> Result<(), String> {
    let path = paused_state_path().ok_or("No se pudo obtener directorio de config")?;
    let json = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| format!("Guardar estado pausado: {}", e))?;
    Ok(())
}

/// Carga el estado de una subida pausada, si existe.
pub fn load_paused_state() -> Option<PausedUploadState> {
    let path = paused_state_path()?;
    let json = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&json).ok()
}

/// Elimina el archivo de estado pausado (tras reanudar con éxito o al cancelar).
pub fn remove_paused_state_file() {
    if let Some(p) = paused_state_path() {
        let _ = std::fs::remove_file(p);
    }
}

/// Tamaño de cada parte (S3 mínimo 5 MiB excepto la última). 10 MiB es un buen equilibrio.
pub(crate) const PART_SIZE: u64 = 10 * 1024 * 1024;

/// Umbral: archivos mayores usan multipart; menores usan PUT simple.
pub(crate) const MULTIPART_THRESHOLD: u64 = 5 * 1024 * 1024;

/// Cuántas partes pedir por llamada a part-urls.
const PARTS_PER_URL_BATCH: u32 = 32;

/// Reintentos para operaciones que pueden fallar por red o 5xx (init, part-urls, complete, PUT parte).
const MAX_RETRIES: u32 = 3;
/// Segundos de espera entre reintentos (backoff: 1ª espera 1s, 2ª espera 2s).
const RETRY_DELAY_SECS: u64 = 1;

/// Cuántas partes se suben en paralelo (acelera mucho archivos grandes).
const MULTIPART_PUT_CONCURRENCY: usize = 8;

/// Ejecuta una operación async con reintentos y backoff. Devuelve el último error si todos fallan.
async fn with_retry<F, Fut, T>(mut op: F) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let mut last_err = String::new();
    for attempt in 0..MAX_RETRIES {
        match op().await {
            Ok(t) => return Ok(t),
            Err(e) => {
                last_err = e.clone();
                if attempt + 1 < MAX_RETRIES {
                    let delay = RETRY_DELAY_SECS * (attempt + 1) as u64;
                    tokio::time::sleep(tokio::time::Duration::from_secs(delay)).await;
                }
            }
        }
    }
    Err(last_err)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct MultipartInitResponse {
    upload_id: String,
    key: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PartUrlsRequest {
    key: String,
    upload_id: String,
    part_numbers: Vec<u32>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartUrlItem {
    part_number: u32,
    url: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PartUrlsResponse {
    part_urls: Vec<PartUrlItem>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CompleteRequest {
    key: String,
    upload_id: String,
    parts: Vec<CompletedPartReq>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CompletedPartReq {
    part_number: u32,
    etag: String,
}

async fn multipart_init(
    api_base: &str,
    user_id: &str,
    api_key: &str,
    game_id: &str,
    filename: &str,
) -> Result<(String, String), String> {
    let body = serde_json::json!({
        "gameId": game_id,
        "filename": filename
    });
    let res = api::api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/multipart/init",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| format!("multipart/init: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        sync_logger::log_api("multipart/init", "/multipart/init", status.as_u16(), &text);
        return Err(format!("API multipart/init: {} {}", status, text));
    }

    let parsed: MultipartInitResponse =
        res.json().await.map_err(|e| format!("parse init: {}", e))?;
    Ok((parsed.upload_id, parsed.key))
}

async fn multipart_part_urls(
    api_base: &str,
    user_id: &str,
    api_key: &str,
    key: &str,
    upload_id: &str,
    part_numbers: &[u32],
) -> Result<Vec<(u32, String)>, String> {
    if part_numbers.is_empty() {
        return Ok(Vec::new());
    }
    let body = PartUrlsRequest {
        key: key.to_string(),
        upload_id: upload_id.to_string(),
        part_numbers: part_numbers.to_vec(),
    };
    let body_bytes =
        serde_json::to_vec(&body).map_err(|e| format!("serialize part-urls: {}", e))?;
    let res = api::api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/multipart/part-urls",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("multipart/part-urls: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        sync_logger::log_api(
            "multipart/part-urls",
            "/multipart/part-urls",
            status.as_u16(),
            &text,
        );
        return Err(format!("API multipart/part-urls: {} {}", status, text));
    }

    let parsed: PartUrlsResponse = res
        .json()
        .await
        .map_err(|e| format!("parse part-urls: {}", e))?;
    Ok(parsed
        .part_urls
        .into_iter()
        .map(|p| (p.part_number, p.url))
        .collect())
}

async fn multipart_complete(
    api_base: &str,
    user_id: &str,
    api_key: &str,
    key: &str,
    upload_id: &str,
    parts: &[(u32, String)],
) -> Result<(), String> {
    let body = CompleteRequest {
        key: key.to_string(),
        upload_id: upload_id.to_string(),
        parts: parts
            .iter()
            .map(|(n, etag)| CompletedPartReq {
                part_number: *n,
                etag: etag.clone(),
            })
            .collect(),
    };
    let body_bytes = serde_json::to_vec(&body).map_err(|e| format!("serialize complete: {}", e))?;
    let res = api::api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/multipart/complete",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("multipart/complete: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        sync_logger::log_api(
            "multipart/complete",
            "/multipart/complete",
            status.as_u16(),
            &text,
        );
        return Err(format!("API multipart/complete: {} {}", status, text));
    }
    Ok(())
}

async fn multipart_abort(
    api_base: &str,
    user_id: &str,
    api_key: &str,
    key: &str,
    upload_id: &str,
) -> Result<(), String> {
    let body = serde_json::json!({ "key": key, "uploadId": upload_id });
    let res = api::api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/multipart/abort",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| format!("multipart/abort: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        sync_logger::log_api(
            "multipart/abort",
            "/multipart/abort",
            status.as_u16(),
            &text,
        );
        return Err(format!("API multipart/abort: {} {}", status, text));
    }
    Ok(())
}

/// Función de ayuda que encapsula el hilo "Productor".
/// Genera URLs en lotes y las inyecta en el canal (tx) para que los workers las consuman.
fn spawn_url_prefetcher(
    api_base: String,
    user_id: String,
    api_key: String,
    key: String,
    upload_id: String,
    total_size: u64,
    parts_to_fetch: Vec<u32>,
    tx: mpsc::Sender<(u32, u64, u64, String)>,
    cancel: Option<std::sync::Arc<crate::tray::tray_state::TrayStateInner>>,
) {
    tokio::spawn(async move {
        for chunk in parts_to_fetch.chunks(PARTS_PER_URL_BATCH as usize) {
            if let Some(ref t) = cancel {
                if t.upload_cancel_requested() || t.upload_pause_requested() {
                    break;
                }
            }

            let urls_result = with_retry(|| {
                multipart_part_urls(&api_base, &user_id, &api_key, &key, &upload_id, chunk)
            })
            .await;

            match urls_result {
                Ok(urls) => {
                    for (num, url) in urls {
                        let start = (num - 1) as u64 * PART_SIZE;
                        let part_len = std::cmp::min(PART_SIZE, total_size.saturating_sub(start));

                        // Si el canal está lleno, `.send` esperará a que un worker termine
                        if tx.send((num, start, part_len, url)).await.is_err() {
                            return; // El consumidor (rx) se ha cerrado, abortamos la tarea
                        }
                    }
                }
                Err(e) => {
                    sync_logger::log_operation("upload_prefetch_error", &e);
                    break;
                }
            }
        }
    });
}

/// Sube un archivo mediante multipart. Emite progreso y respeta cancelación entre partes.
pub(crate) async fn upload_one_file_multipart(
    absolute_path: &Path,
    relative_filename: &str,
    total_size: u64,
    game_id: &str,
    api_base: &str,
    user_id: &str,
    api_key: &str,
    app: tauri::AppHandle,
    cancel: Option<std::sync::Arc<crate::tray::tray_state::TrayStateInner>>,
) -> Result<(), String> {
    let ctx =
        sync_logger::upload_context(game_id, relative_filename, &absolute_path.to_string_lossy());
    sync_logger::log_operation("upload_multipart_start", &ctx);

    let num_parts = if total_size == 0 {
        0u32
    } else {
        total_size.div_ceil(PART_SIZE) as u32
    };

    let (upload_id, key) = if num_parts == 0 {
        let (uid, k) =
            with_retry(|| multipart_init(api_base, user_id, api_key, game_id, relative_filename))
                .await?;
        multipart_complete(api_base, user_id, api_key, &k, &uid, &[]).await?;
        emit_sync_upload_progress(
            &app,
            SyncProgressPayload {
                operation_id: Some(format!("sync-upload-{}", game_id)),
                status: Some("running".to_string()),
                game_id: game_id.to_string(),
                filename: relative_filename.to_string(),
                loaded: total_size,
                total: total_size,
                downloaded_bytes: Some(total_size),
                total_bytes: Some(total_size),
                can_pause: None,
                can_cancel: None,
                can_resume: None,
                strategy: Some(SyncOperationStrategy::Multipart),
                state: None,
                reason_code: None,
            },
        );
        return Ok(());
    } else {
        with_retry(|| multipart_init(api_base, user_id, api_key, game_id, relative_filename))
            .await?
    };

    // Canal con capacidad limitada para aplicar contrapresión (Backpressure)
    let (tx, rx) = mpsc::channel::<(u32, u64, u64, String)>(MULTIPART_PUT_CONCURRENCY * 2);

    let parts_to_fetch: Vec<u32> = (1..=num_parts).collect();

    spawn_url_prefetcher(
        api_base.to_string(),
        user_id.to_string(),
        api_key.to_string(),
        key.clone(),
        upload_id.clone(),
        total_size,
        parts_to_fetch,
        tx,
        cancel.clone(),
    );

    let path_buf = absolute_path.to_path_buf();
    let game_id_owned = game_id.to_string();
    let filename_owned = relative_filename.to_string();

    let mut completed_parts: Vec<(u32, String)> = Vec::with_capacity(num_parts as usize);
    let mut loaded: u64 = 0;

    // Tarea Consumidora: Workers procesando el flujo de URLs
    let mut stream = ReceiverStream::new(rx)
        .map(|(part_number, start, part_len, url)| {
            let path = path_buf.clone();
            async move {
                let mut f = tokio::fs::File::open(&path)
                    .await
                    .map_err(|e| format!("abrir parte {}: {}", part_number, e))?;
                f.seek(SeekFrom::Start(start))
                    .await
                    .map_err(|e| format!("seek parte {}: {}", part_number, e))?;
                let mut buf = vec![0u8; part_len as usize];
                AsyncReadExt::read_exact(&mut f, &mut buf)
                    .await
                    .map_err(|e| format!("leer parte {}: {}", part_number, e))?;

                let res = DATA_CLIENT
                    .put(&url)
                    .body(buf)
                    .header("Content-Type", "application/octet-stream")
                    .send()
                    .await
                    .map_err(|e| format!("PUT parte {}: {}", part_number, e))?;

                if !res.status().is_success() {
                    return Err(format!("parte {}: S3 PUT {}", part_number, res.status()));
                }
                let etag = res
                    .headers()
                    .get("etag")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                Ok((part_number, etag, part_len))
            }
        })
        .buffer_unordered(MULTIPART_PUT_CONCURRENCY);

    while let Some(result) = stream.next().await {
        if let Some(ref t) = cancel {
            if t.upload_cancel_requested() {
                let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
                return Err("Subida cancelada".to_string());
            }
            if t.upload_pause_requested() {
                let state = PausedUploadState {
                    upload_id: upload_id.clone(),
                    key: key.clone(),
                    game_id: game_id_owned.clone(),
                    filename: filename_owned.clone(),
                    absolute_path: absolute_path.to_string_lossy().to_string(),
                    total_size,
                    completed_parts: completed_parts
                        .iter()
                        .map(|(n, e)| CompletedPartState {
                            part_number: *n,
                            etag: e.clone(),
                        })
                        .collect(),
                };
                save_paused_state(&state).map_err(|e| format!("guardar pausa: {}", e))?;
                return Err(PAUSED_ERR_MSG.to_string());
            }
        }

        let (part_number, etag, part_len) = match result {
            Ok(x) => x,
            Err(e) => {
                let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
                return Err(e);
            }
        };
        completed_parts.push((part_number, etag));
        loaded = std::cmp::min(loaded + part_len, total_size);
        emit_sync_upload_progress(
            &app,
            SyncProgressPayload {
                operation_id: Some(format!("sync-upload-{}", game_id_owned)),
                status: Some("running".to_string()),
                game_id: game_id_owned.clone(),
                filename: filename_owned.clone(),
                loaded,
                total: total_size,
                downloaded_bytes: Some(loaded),
                total_bytes: Some(total_size),
                can_pause: None,
                can_cancel: None,
                can_resume: None,
                strategy: Some(SyncOperationStrategy::Multipart),
                state: None,
                reason_code: None,
            },
        );
    }

    if completed_parts.len() < num_parts as usize {
        let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
        return Err("Error: La subida finalizó de forma incompleta (posible fallo de red)".into());
    }

    completed_parts.sort_by_key(|p| p.0);

    with_retry(|| {
        multipart_complete(
            api_base,
            user_id,
            api_key,
            &key,
            &upload_id,
            &completed_parts,
        )
    })
    .await?;

    Ok(())
}

/// Reanuda una subida multipart desde el estado guardado en disco con concurrencia.
pub(crate) async fn resume_paused_upload(
    app: tauri::AppHandle,
    cancel: Option<std::sync::Arc<crate::tray::tray_state::TrayStateInner>>,
) -> Result<(), String> {
    let state = load_paused_state().ok_or("No hay ninguna subida pausada")?;

    let api_ctx = super::context::resolve_api_context()?;
    let api_base = api_ctx.base_url.as_str();
    let user_id = api_ctx.user_id.as_str();
    let api_key = api_ctx.api_key.as_str();

    let num_parts = if state.total_size == 0 {
        0u32
    } else {
        state.total_size.div_ceil(PART_SIZE) as u32
    };

    let completed_set: HashSet<u32> = state
        .completed_parts
        .iter()
        .map(|p| p.part_number)
        .collect();

    let remaining: Vec<u32> = (1..=num_parts)
        .filter(|n| !completed_set.contains(n))
        .collect();

    if remaining.is_empty() {
        multipart_complete(
            api_base,
            user_id,
            api_key,
            &state.key,
            &state.upload_id,
            &state
                .completed_parts
                .iter()
                .map(|p| (p.part_number, p.etag.clone()))
                .collect::<Vec<_>>(),
        )
        .await?;
        remove_paused_state_file();

        // Emitir 100% de progreso al frontend
        emit_sync_upload_progress(
            &app,
            SyncProgressPayload {
                operation_id: Some(format!("sync-upload-{}", state.game_id)),
                status: Some("running".to_string()),
                game_id: state.game_id.clone(),
                filename: state.filename.clone(),
                loaded: state.total_size,
                total: state.total_size,
                downloaded_bytes: Some(state.total_size),
                total_bytes: Some(state.total_size),
                can_pause: None,
                can_cancel: None,
                can_resume: None,
                strategy: Some(SyncOperationStrategy::Multipart),
                state: None,
                reason_code: None,
            },
        );
        return Ok(());
    }

    let (tx, rx) = mpsc::channel::<(u32, u64, u64, String)>(MULTIPART_PUT_CONCURRENCY * 2);

    spawn_url_prefetcher(
        api_base.to_string(),
        user_id.to_string(),
        api_key.to_string(),
        state.key.clone(),
        state.upload_id.clone(),
        state.total_size,
        remaining,
        tx,
        cancel.clone(),
    );

    let mut all_parts: Vec<(u32, String)> = state
        .completed_parts
        .iter()
        .map(|p| (p.part_number, p.etag.clone()))
        .collect();

    let path_buf = PathBuf::from(&state.absolute_path);
    let mut loaded = (all_parts.len() as u64) * PART_SIZE;

    let mut stream = ReceiverStream::new(rx)
        .map(|(part_number, start, part_len, url)| {
            let path = path_buf.clone();
            async move {
                let mut f = tokio::fs::File::open(&path)
                    .await
                    .map_err(|e| format!("abrir archivo para reanudar {}: {}", part_number, e))?;
                f.seek(SeekFrom::Start(start))
                    .await
                    .map_err(|e| format!("seek parte {}: {}", part_number, e))?;
                let mut buf = vec![0u8; part_len as usize];
                AsyncReadExt::read_exact(&mut f, &mut buf)
                    .await
                    .map_err(|e| format!("leer parte {}: {}", part_number, e))?;

                let res = DATA_CLIENT
                    .put(&url)
                    .body(buf)
                    .header("Content-Type", "application/octet-stream")
                    .send()
                    .await
                    .map_err(|e| format!("PUT parte {}: {}", part_number, e))?;

                if !res.status().is_success() {
                    return Err(format!("parte {}: S3 PUT {}", part_number, res.status()));
                }
                let etag = res
                    .headers()
                    .get("etag")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                Ok((part_number, etag, part_len))
            }
        })
        .buffer_unordered(MULTIPART_PUT_CONCURRENCY);

    let required_parts_len = num_parts as usize;

    while let Some(result) = stream.next().await {
        if let Some(ref t) = cancel {
            if t.upload_cancel_requested() {
                let _ =
                    multipart_abort(api_base, user_id, api_key, &state.key, &state.upload_id).await;
                remove_paused_state_file();
                return Err("Subida cancelada".to_string());
            }
            if t.upload_pause_requested() {
                let mut new_state = state.clone();
                new_state.completed_parts = all_parts
                    .iter()
                    .map(|(n, e)| CompletedPartState {
                        part_number: *n,
                        etag: e.clone(),
                    })
                    .collect();
                save_paused_state(&new_state).map_err(|e| format!("guardar pausa: {}", e))?;
                return Err(PAUSED_ERR_MSG.to_string());
            }
        }

        let (part_number, etag, part_len) = match result {
            Ok(x) => x,
            Err(e) => {
                let _ =
                    multipart_abort(api_base, user_id, api_key, &state.key, &state.upload_id).await;
                remove_paused_state_file();
                return Err(e);
            }
        };

        all_parts.push((part_number, etag));
        loaded = std::cmp::min(loaded + part_len, state.total_size);

        emit_sync_upload_progress(
            &app,
            SyncProgressPayload {
                operation_id: Some(format!("sync-upload-{}", state.game_id)),
                status: Some("running".to_string()),
                game_id: state.game_id.clone(),
                filename: state.filename.clone(),
                loaded,
                total: state.total_size,
                downloaded_bytes: Some(loaded),
                total_bytes: Some(state.total_size),
                can_pause: None,
                can_cancel: None,
                can_resume: None,
                strategy: Some(SyncOperationStrategy::Multipart),
                state: None,
                reason_code: None,
            },
        );
    }

    if all_parts.len() < required_parts_len {
        return Err("Error: La reanudación finalizó de forma incompleta".into());
    }

    all_parts.sort_by_key(|p| p.0);
    with_retry(|| {
        multipart_complete(
            api_base,
            user_id,
            api_key,
            &state.key,
            &state.upload_id,
            &all_parts,
        )
    })
    .await?;

    remove_paused_state_file();
    Ok(())
}
