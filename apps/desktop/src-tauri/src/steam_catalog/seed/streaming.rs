use super::db::apply_seed_updates;
use super::types::SteamSeedBatchLine;
use crate::network::API_CLIENT;
use crate::sqlite::AppDb;
use futures_util::StreamExt;
use std::sync::Arc;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;
use tokio_util::io::StreamReader;

const DEFAULT_CHUNK_SIZE: usize = 50_000;

/// Contexto de progreso para la emisión de eventos durante el streaming.
pub struct StreamProgressContext {
    pub iteration: u32,
    pub total_batches_this_round: u32,
    pub global_total_batches: u32,
    pub global_total_rows: u32,
}

/// Importa un batch de semillas Steam utilizando streaming HTTP + parsing paralelo.
pub async fn stream_import_batch(
    app: Option<&tauri::AppHandle>,
    ctx: Option<&StreamProgressContext>,
    batch_key: &str,
    db: &AppDb,
    download_url_str: &str,
    chunk_size: Option<usize>,
    write_lock: Arc<Mutex<()>>,
) -> Result<u32, String> {
    let chunk_size = chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE);

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

    let response = API_CLIENT
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
        .map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)));
    let stream_reader = StreamReader::new(bytes_stream);
    let mut lines_reader = BufReader::new(stream_reader).lines();

    let worker_count = num_cpus::get().clamp(2, 8);

    let mut raw_lines: Vec<String> = Vec::with_capacity(4096);
    while let Ok(Some(line)) = lines_reader.next_line().await {
        let trimmed = line.trim().to_string();
        if !trimmed.is_empty() {
            raw_lines.push(trimmed);
        }
    }

    if raw_lines.is_empty() {
        return Ok(0);
    }

    // Dividimos las líneas en chunks iguales, uno por worker.
    // Cada worker tiene su propio subvector → cero contención.
    let total_lines = raw_lines.len();
    let chunk_per_worker = (total_lines + worker_count - 1) / worker_count;

    let chunks: Vec<Vec<String>> = raw_lines
        .chunks(chunk_per_worker)
        .map(|c| c.to_vec())
        .collect();

    let mut parse_handles = Vec::with_capacity(chunks.len());
    for chunk in chunks {
        parse_handles.push(tokio::task::spawn_blocking(move || {
            let mut out: Vec<(u32, serde_json::Value, i64)> = Vec::with_capacity(chunk.len());
            for line in &chunk {
                if let Ok(parsed) = serde_json::from_str::<SteamSeedBatchLine>(line) {
                    if parsed.steam_success == Some(true) {
                        if let Some(data) = parsed.data {
                            let score =
                                crate::steam_catalog::scoring::compute_rank_score_from_value(&data);
                            out.push((parsed.app_id, data, score));
                        }
                    }
                }
            }
            out
        }));
    }

    // Recolectamos todos los resultados
    let mut all_updates: Vec<(u32, serde_json::Value, i64)> = Vec::with_capacity(total_lines);
    for handle in parse_handles {
        match handle.await {
            Ok(partial) => all_updates.extend(partial),
            Err(e) => eprintln!("[steam-seed] Worker de parseo falló: {}", e),
        }
    }

    if all_updates.is_empty() {
        return Ok(0);
    }

    // Procesamos en chunks del tamaño configurado.
    let db_clone = db.clone();
    let batch_key_owned = batch_key.to_string();
    let mut total_updated = 0u32;

    for (i, write_chunk) in all_updates.chunks(chunk_size).enumerate() {
        let chunk_vec = write_chunk.to_vec();
        if i > 0 {
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
                            i + 1,
                            batch_key_owned
                        )),
                        current_batch: Some(batch_key_owned.clone()),
                        done: false,
                    },
                );
            }
        }

        let db_write = db_clone.clone();

        let _guard = write_lock.lock().await;

        let n = tokio::task::spawn_blocking(move || {
            db_write.with_conn(|conn| apply_seed_updates(conn, &chunk_vec))
        })
        .await
        .map_err(|e| format!("spawn_blocking falló: {}", e))?
        .map_err(|e| format!("Error en batch insert: {}", e))?;

        total_updated = total_updated.saturating_add(n);
    }

    Ok(total_updated)
}
