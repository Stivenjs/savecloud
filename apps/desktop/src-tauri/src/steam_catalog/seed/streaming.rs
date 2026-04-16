use super::db::apply_seed_updates;
use super::types::SteamSeedBatchLine;
use crate::network::API_CLIENT;
use crate::sqlite::AppDb;
use futures_util::StreamExt;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;
use tokio_util::io::StreamReader;

const DEFAULT_CHUNK_SIZE: usize = 5000;
const LINE_GROUP_SIZE: usize = 500;

/// Contexto de progreso para la emisión de eventos durante el streaming.
pub struct StreamProgressContext {
    pub iteration: u32,
    pub total_batches_this_round: u32,
    pub global_total_batches: u32,
    pub global_total_rows: u32,
}

/// Importa un batch de semillas Steam utilizando una estrategia de streaming y
/// procesamiento paralelo de JSON.
pub async fn stream_import_batch(
    app: Option<&tauri::AppHandle>,
    ctx: Option<&StreamProgressContext>,
    batch_key: &str,
    db: &AppDb,
    download_url_str: &str,
    chunk_size: Option<usize>,
) -> Result<u32, String> {
    let chunk_size = chunk_size.unwrap_or(DEFAULT_CHUNK_SIZE);
    let worker_count = num_cpus::get().clamp(1, 8);

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

    // 1. Iniciamos la descarga por streaming
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

    // Convertimos el stream de bytes de reqwest en un AsyncRead para usar BufReader
    let bytes_stream = response
        .bytes_stream()
        .map(|result| result.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)));
    let stream_reader = StreamReader::new(bytes_stream);
    let mut lines_reader = BufReader::new(stream_reader).lines();

    // 2. Definimos los canales de comunicación
    // Canal para GRUPOS de líneas (entrada a workers) para reducir contención de Mutex
    let (tx_lines, rx_lines) = mpsc::channel::<Vec<String>>(worker_count * 2);
    // Canal para updates parseados (salida de workers)
    let (tx_updates, mut rx_updates) = mpsc::channel::<(u32, serde_json::Value)>(chunk_size * 2);

    // 3. Spawneamos el lector de líneas
    let reader_handle = tokio::spawn(async move {
        let mut group = Vec::with_capacity(LINE_GROUP_SIZE);
        while let Ok(Some(line)) = lines_reader.next_line().await {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            group.push(line.to_string());
            if group.len() >= LINE_GROUP_SIZE {
                if tx_lines
                    .send(std::mem::replace(
                        &mut group,
                        Vec::with_capacity(LINE_GROUP_SIZE),
                    ))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
        if !group.is_empty() {
            let _ = tx_lines.send(group).await;
        }
    });

    // 4. Spawneamos los workers de procesamiento paralelo
    let mut worker_handles = Vec::new();
    let rx_lines = std::sync::Arc::new(tokio::sync::Mutex::new(rx_lines));

    for _ in 0..worker_count {
        let rx_lines_clone = rx_lines.clone();
        let tx_updates_clone = tx_updates.clone();

        worker_handles.spawn(tokio::spawn(async move {
            loop {
                let lines = {
                    let mut rx = rx_lines_clone.lock().await;
                    rx.recv().await
                };

                match lines {
                    Some(batch) => {
                        for l in batch {
                            if let Ok(parsed) = serde_json::from_str::<SteamSeedBatchLine>(&l) {
                                if parsed.steam_success == Some(true) {
                                    if let Some(data) = parsed.data {
                                        if tx_updates_clone
                                            .send((parsed.app_id, data))
                                            .await
                                            .is_err()
                                        {
                                            return;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    None => break,
                }
            }
        }));
    }
    // Cerramos el sender original para que los workers terminen cuando el reader acabe
    drop(tx_updates);

    // 5. Consumidor de base de datos (Sink)
    let db_clone = db.clone();
    let mut total_updated = 0u32;
    let mut current_chunk = Vec::with_capacity(chunk_size);

    while let Some(update) = rx_updates.recv().await {
        current_chunk.push(update);
        if current_chunk.len() >= chunk_size {
            let chunk_to_save =
                std::mem::replace(&mut current_chunk, Vec::with_capacity(chunk_size));

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
                            "Guardando {} semillas en {}...",
                            chunk_to_save.len(),
                            batch_key
                        )),
                        current_batch: Some(batch_key.to_string()),
                        done: false,
                    },
                );
            }

            let n = db_clone
                .with_conn(|conn| apply_seed_updates(conn, &chunk_to_save))
                .map_err(|e| format!("Error en batch insert: {}", e))?;
            total_updated = total_updated.saturating_add(n);
        }
    }

    // Flush final
    if !current_chunk.is_empty() {
        let n = db_clone
            .with_conn(|conn| apply_seed_updates(conn, &current_chunk))
            .map_err(|e| format!("Error en flush final: {}", e))?;
        total_updated = total_updated.saturating_add(n);
    }

    let _ = reader_handle.await;

    Ok(total_updated)
}

/// Helper para extender un vector de handles (no existe nativo pero lo emulamos)
trait HandleVecExt {
    fn spawn(&mut self, handle: tokio::task::JoinHandle<()>);
}

impl HandleVecExt for Vec<tokio::task::JoinHandle<()>> {
    fn spawn(&mut self, handle: tokio::task::JoinHandle<()>) {
        self.push(handle);
    }
}
