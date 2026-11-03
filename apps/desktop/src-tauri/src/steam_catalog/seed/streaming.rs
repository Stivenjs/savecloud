use super::db::apply_seed_updates;
use super::request::validate_presigned_url;
use super::types::{SteamReviewsBatchLine, SteamSeedBatchLine};
use crate::network::DATA_CLIENT;
use crate::sqlite::AppDb;
use futures_util::StreamExt;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;
use tokio_util::io::StreamReader;

async fn parse_seed_lines(
    lines: Vec<String>,
    batch_key: &str,
) -> Result<Vec<(u32, serde_json::Value)>, String> {
    let parse_batch_key = batch_key.to_string();
    let result = tokio::task::spawn_blocking(move || {
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
    .map_err(|error| format!("Worker de parseo falló en batch {batch_key}: {error}"))?;

    result
}

pub async fn persist_seed_group(
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

pub async fn persist_reviews_group(
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

/// Descarga y parsea un batch de detalles sin competir por el escritor SQLite.
pub async fn download_seed_batch(
    batch_key: &str,
    download_url_str: &str,
) -> Result<Vec<(u32, serde_json::Value)>, String> {
    validate_presigned_url(download_url_str)?;

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
    let mut raw_lines = Vec::with_capacity(4096);
    while let Some(line) = lines_reader
        .next_line()
        .await
        .map_err(|e| format!("Error leyendo batch {batch_key}: {e}"))?
    {
        if line.trim().is_empty() {
            continue;
        }
        raw_lines.push(line);
    }

    let updates = parse_seed_lines(raw_lines, batch_key).await?;

    Ok(updates)
}

/// Descarga y parsea un batch de reviews sin competir por el escritor SQLite.
pub async fn download_reviews_batch(
    batch_key: &str,
    download_url_str: &str,
) -> Result<Vec<(u32, super::types::SteamReviewSummary)>, String> {
    validate_presigned_url(download_url_str)?;

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
    let mut updates = Vec::with_capacity(4096);
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
                updates.push((parsed.app_id, summary));
            }
        }
    }

    Ok(updates)
}
