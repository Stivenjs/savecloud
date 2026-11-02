use super::db::apply_seed_updates;
use super::request::validate_presigned_url;
use super::types::{SteamReviewsBatchLine, SteamSeedBatchLine};
use crate::network::DATA_CLIENT;
use crate::sqlite::AppDb;
use futures_util::StreamExt;
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;
use tokio_util::io::StreamReader;

const DEFAULT_CHUNK_SIZE: usize = 50_000;

async fn parse_seed_lines(
    lines: Vec<String>,
    batch_key: &str,
) -> Result<Vec<(u32, serde_json::Value)>, String> {
    let parse_batch_key = batch_key.to_string();
    tokio::task::spawn_blocking(move || {
        let mut updates = Vec::with_capacity(lines.len());
        for line in lines {
            let parsed = serde_json::from_str::<SteamSeedBatchLine>(&line)
                .map_err(|_| format!("Línea JSON inválida en batch {parse_batch_key}"))?;
            if parsed.steam_success == Some(true) {
                if let Some(data) = parsed.data {
                    updates.push((parsed.app_id, data));
                }
            }
        }
        Ok(updates)
    })
    .await
    .map_err(|error| format!("Worker de parseo falló en batch {batch_key}: {error}"))?
}

async fn persist_seed_chunk(
    db: &AppDb,
    updates: Vec<(u32, serde_json::Value)>,
    write_lock: &Mutex<()>,
) -> Result<u32, String> {
    let _guard = write_lock.lock().await;
    let db_clone = db.clone();
    tokio::task::spawn_blocking(move || {
        db_clone.with_conn(|conn| apply_seed_updates(conn, &updates))
    })
    .await
    .map_err(|error| format!("spawn_blocking falló: {error}"))?
    .map_err(|error| format!("Error en batch insert: {error}"))
}

async fn persist_reviews_chunk(
    db: &AppDb,
    updates: Vec<(u32, super::types::SteamReviewSummary)>,
    write_lock: &Mutex<()>,
) -> Result<u32, String> {
    let _guard = write_lock.lock().await;
    let db_clone = db.clone();
    tokio::task::spawn_blocking(move || {
        db_clone.with_conn(|conn| super::db::apply_reviews_updates(conn, &updates))
    })
    .await
    .map_err(|error| format!("spawn_blocking reviews falló: {error}"))?
    .map_err(|error| format!("Error en persistencia de reviews: {error}"))
}

/// Contexto de progreso para la emisión de eventos durante el streaming.
pub struct StreamProgressContext {
    pub iteration: u32,
    pub total_batches_this_round: u32,
    pub global_total_batches: u32,
    pub global_total_rows: u32,
}

/// Importa un batch de semillas Steam procesando y persistiendo cada chunk en streaming.
pub async fn stream_import_batch(
    app: Option<&tauri::AppHandle>,
    ctx: Option<&StreamProgressContext>,
    batch_key: &str,
    db: &AppDb,
    download_url_str: &str,
    chunk_size: Option<usize>,
    write_lock: Arc<Mutex<()>>,
) -> Result<u32, String> {
    let chunk_size = chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE).max(1);
    validate_presigned_url(download_url_str)?;

    if let (Some(a), Some(c)) = (app, ctx) {
        let _ = a.emit(
            "steam-seed-import-progress",
            super::types::SteamSeedImportProgressPayload {
                iteration: c.iteration,
                batches_this_round: c.total_batches_this_round,
                rows_this_round: 0,
                total_batches: c.global_total_batches,
                total_rows_updated: c.global_total_rows,
                status_text: Some(format!("Descargando batch {}...", batch_key)),
                current_batch: Some(batch_key.to_string()),
                done: false,
            },
        );
    }

    let response = DATA_CLIENT
        .get(download_url_str)
        .send()
        .await
        .map_err(|e| format!("Fallo al iniciar descarga streaming: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Error HTTP al descargar batch: {}",
            response.status()
        ));
    }

    let bytes_stream = response
        .bytes_stream()
        .map(|r| r.map_err(std::io::Error::other));
    let stream_reader = StreamReader::new(bytes_stream);
    let mut lines_reader = BufReader::new(stream_reader).lines();

    let mut pending_lines = Vec::with_capacity(chunk_size.min(4096));
    let mut total_updated = 0u32;
    let mut chunk_index = 0usize;
    while let Some(line) = lines_reader
        .next_line()
        .await
        .map_err(|e| format!("Error leyendo batch {batch_key}: {e}"))?
    {
        if line.trim().is_empty() {
            continue;
        }
        pending_lines.push(line);
        if pending_lines.len() < chunk_size {
            continue;
        }

        chunk_index += 1;
        let lines = std::mem::take(&mut pending_lines);
        let updates = parse_seed_lines(lines, batch_key).await?;
        if updates.is_empty() {
            continue;
        }
        if chunk_index > 1 {
            if let (Some(a), Some(c)) = (app, ctx) {
                let _ = a.emit(
                    "steam-seed-import-progress",
                    super::types::SteamSeedImportProgressPayload {
                        iteration: c.iteration,
                        batches_this_round: c.total_batches_this_round,
                        rows_this_round: total_updated,
                        total_batches: c.global_total_batches,
                        total_rows_updated: c.global_total_rows.saturating_add(total_updated),
                        status_text: Some(format!(
                            "Guardando chunk {} de {}...",
                            chunk_index, batch_key
                        )),
                        current_batch: Some(batch_key.to_string()),
                        done: false,
                    },
                );
            }
        }
        let app_ids: Vec<u32> = updates.iter().map(|(app_id, _)| *app_id).collect();
        total_updated =
            total_updated.saturating_add(persist_seed_chunk(db, updates, &write_lock).await?);
        for app_id in app_ids {
            crate::steam_cache::steam_api_cache().invalidate(&app_id.to_string());
        }
    }

    if !pending_lines.is_empty() {
        let lines = std::mem::take(&mut pending_lines);
        let updates = parse_seed_lines(lines, batch_key).await?;
        if !updates.is_empty() {
            let app_ids: Vec<u32> = updates.iter().map(|(app_id, _)| *app_id).collect();
            total_updated =
                total_updated.saturating_add(persist_seed_chunk(db, updates, &write_lock).await?);
            for app_id in app_ids {
                crate::steam_cache::steam_api_cache().invalidate(&app_id.to_string());
            }
        }
    }

    Ok(total_updated)
}

/// Importa un batch NDJSON de reviews Steam y persiste resúmenes en SQLite.
pub async fn stream_import_reviews_batch(
    app: Option<&tauri::AppHandle>,
    ctx: Option<&StreamProgressContext>,
    batch_key: &str,
    db: &AppDb,
    download_url_str: &str,
    write_lock: Arc<Mutex<()>>,
) -> Result<u32, String> {
    validate_presigned_url(download_url_str)?;

    if let (Some(a), Some(c)) = (app, ctx) {
        let _ = a.emit(
            "steam-seed-import-progress",
            super::types::SteamSeedImportProgressPayload {
                iteration: c.iteration,
                batches_this_round: c.total_batches_this_round,
                rows_this_round: 0,
                total_batches: c.global_total_batches,
                total_rows_updated: c.global_total_rows,
                status_text: Some(format!("Descargando reviews {}...", batch_key)),
                current_batch: Some(batch_key.to_string()),
                done: false,
            },
        );
    }

    let response = DATA_CLIENT
        .get(download_url_str)
        .send()
        .await
        .map_err(|e| format!("Fallo al iniciar descarga streaming de reviews: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Error HTTP al descargar batch de reviews: {}",
            response.status()
        ));
    }

    let bytes_stream = response
        .bytes_stream()
        .map(|r| r.map_err(std::io::Error::other));
    let stream_reader = StreamReader::new(bytes_stream);
    let mut lines_reader = BufReader::new(stream_reader).lines();

    let mut pending_updates = Vec::with_capacity(DEFAULT_CHUNK_SIZE.min(4096));
    let mut total_updated = 0u32;
    while let Some(line) = lines_reader
        .next_line()
        .await
        .map_err(|e| format!("Error leyendo batch de reviews {batch_key}: {e}"))?
    {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let parsed = serde_json::from_str::<SteamReviewsBatchLine>(trimmed)
            .map_err(|e| format!("Línea JSON inválida en batch de reviews {batch_key}: {e}"))?;
        if parsed.reviews_success == Some(true) {
            if let Some(summary) = parsed.summary {
                pending_updates.push((parsed.app_id, summary));
            }
        }

        if pending_updates.len() >= DEFAULT_CHUNK_SIZE {
            let updates = std::mem::take(&mut pending_updates);
            total_updated = total_updated
                .saturating_add(persist_reviews_chunk(db, updates, &write_lock).await?);
        }
    }

    if !pending_updates.is_empty() {
        total_updated = total_updated
            .saturating_add(persist_reviews_chunk(db, pending_updates, &write_lock).await?);
    }

    Ok(total_updated)
}
