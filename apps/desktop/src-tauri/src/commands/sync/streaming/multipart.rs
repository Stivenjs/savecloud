//! Subida multipart de archivos grandes a S3 en modo streaming.
//!
//! Implementa la transferencia directa desde el stream TAR hacia S3 sin
//! almacenamiento temporal en disco.
//!
//! El buffer de acumulación de partes usaba `Vec<u8>` con `extend_from_slice`
//! seguido de `Bytes::from(mem::take(&mut part_buf))`. Aunque `Bytes::from(Vec)`
//! no copia (transfiere la propiedad), el `Vec::with_capacity` posterior sí
//! reserva nueva memoria en cada parte. Con `BytesMut`, `split_to(part_size).freeze()`
//! separa el chunk del buffer en O(1) sin ninguna allocación, y el buffer principal
//! continúa apuntando al espacio contiguo restante.
//!
//! ## Prefetch de URLs en background real
//!
//! La versión anterior hacía el prefetch de forma inline (await en el loop principal),
//! bloqueando el pipeline mientras esperaba la respuesta del API. La nueva versión
//! lanza el prefetch como una tarea Tokio independiente (`tokio::spawn`) y la almacena
//! en `prefetch_task`. Cuando el loop necesita las URLs, espera la tarea solo si aún
//! no terminó, sin bloquear si ya estaba lista.
//!
//! ## Semáforo de memoria global
//!
//! `strategy.max_inflight_bytes` define el techo de RAM que el pipeline puede consumir
//! simultáneamente. Un `tokio::sync::Semaphore` con `max_inflight_bytes / part_size`
//! permisos controla cuántas partes pueden estar en vuelo a la vez. Cada parte
//! adquiere un permiso antes de enviarse y lo libera al completarse, limitando
//! la presión de memoria sin depender solo de la concurrencia del `JoinSet`.
//!
//! ## Throttle de eventos de progreso
//!
//! Los eventos `sync-upload-progress` solo se emiten cuando se completa una parte
//! completa o cuando cambia el porcentaje entero, evitando inundar el frontend con
//! eventos mientras el encoder TAR llena el buffer interno.

use std::collections::HashMap;
use std::time::Instant;

use bytes::{BufMut, BytesMut};
use tokio::sync::Semaphore;

use crate::network::DATA_CLIENT;

use super::super::api;
use super::super::events::emit_sync_upload_progress;
use super::super::models::{SyncOperationStrategy, SyncProgressPayload};
use super::tar_stream::{TarStreamMsg, TarStreamStats};
use super::upload_strategy::{ConcurrencyController, UploadStrategy};
use crate::commands::logs::sync_logger;

/// Número de URLs solicitadas en cada batch al API.
/// Debe coincidir con `PART_URL_BATCH` en `upload_strategy.rs`.
const PART_URL_BATCH: u32 = 32;

const MAX_RETRIES: u32 = 3;
const RETRY_DELAY_SECS: u64 = 1;

/// Contexto compartido para las operaciones del API.
/// Evita repetir los mismos parámetros en cada función auxiliar.
struct UploadCtx<'a> {
    api_base: &'a str,
    user_id: &'a str,
    api_key: &'a str,
    key: &'a str,
    upload_id: &'a str,
}

// Tipos de request/response del API

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

// Helpers de retry y peticiones al API

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

async fn multipart_init(
    api_base: &str,
    user_id: &str,
    api_key: &str,
    game_id: &str,
    filename: &str,
) -> Result<(String, String), String> {
    let body = serde_json::json!({ "gameId": game_id, "filename": filename });
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
        return Err(format!("API multipart/init: {} {}", status, text));
    }
    let parsed: MultipartInitResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok((parsed.upload_id, parsed.key))
}

async fn multipart_part_urls(
    ctx: &UploadCtx<'_>,
    part_numbers: &[u32],
) -> Result<Vec<(u32, String)>, String> {
    let body = PartUrlsRequest {
        key: ctx.key.to_string(),
        upload_id: ctx.upload_id.to_string(),
        part_numbers: part_numbers.to_vec(),
    };
    let body_bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    let res = api::api_request(
        ctx.api_base,
        ctx.user_id,
        ctx.api_key,
        "POST",
        "/multipart/part-urls",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("multipart/part-urls: {}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API multipart/part-urls: {} {}", status, text));
    }
    let parsed: PartUrlsResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed
        .part_urls
        .into_iter()
        .map(|p| (p.part_number, p.url))
        .collect())
}

async fn multipart_complete(ctx: &UploadCtx<'_>, parts: &[(u32, String)]) -> Result<(), String> {
    let body = CompleteRequest {
        key: ctx.key.to_string(),
        upload_id: ctx.upload_id.to_string(),
        parts: parts
            .iter()
            .map(|(n, etag)| CompletedPartReq {
                part_number: *n,
                etag: etag.clone(),
            })
            .collect(),
    };
    let body_bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
    let res = api::api_request(
        ctx.api_base,
        ctx.user_id,
        ctx.api_key,
        "POST",
        "/multipart/complete",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("multipart/complete: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API multipart/complete: {} {}", status, text));
    }
    Ok(())
}

async fn multipart_abort(ctx: &UploadCtx<'_>) -> Result<(), String> {
    let body = serde_json::json!({ "key": ctx.key, "uploadId": ctx.upload_id });
    let res = api::api_request(
        ctx.api_base,
        ctx.user_id,
        ctx.api_key,
        "POST",
        "/multipart/abort",
        Some(body.to_string().as_bytes()),
    )
    .await
    .map_err(|e| format!("multipart/abort: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API multipart/abort: {} {}", status, text));
    }
    Ok(())
}

type PrefetchTaskOutput = Result<Vec<(u32, String)>, String>;
type PartTaskOutput = Result<(u32, String, u64, u128, tokio::sync::OwnedSemaphorePermit), String>;
type UploadJoinSet = tokio::task::JoinSet<PartTaskOutput>;

/// Estado del prefetch de URLs en background.
///
/// Encapsula la tarea Tokio que fetcha el siguiente batch de URLs mientras el
/// loop principal está ocupado procesando chunks del TAR. Cuando el loop necesita
/// las URLs, espera la tarea solo si aún no terminó, sin bloquear si ya estaba lista.
struct PrefetchState {
    /// Tarea en vuelo que resuelve el siguiente batch de URLs, o `None` si no hay
    /// ningún prefetch en curso.
    task: Option<tokio::task::JoinHandle<PrefetchTaskOutput>>,
}

impl PrefetchState {
    fn new() -> Self {
        Self { task: None }
    }

    /// Lanza un prefetch en background para los `part_numbers` dados.
    ///
    /// Si ya hay una tarea en vuelo, no lanza una nueva para no duplicar peticiones.
    /// El llamador debe comprobar que la tarea anterior terminó antes de llamar de nuevo.
    fn launch(
        &mut self,
        ctx_key: String,
        ctx_upload_id: String,
        ctx_api_base: String,
        ctx_user_id: String,
        ctx_api_key: String,
        part_numbers: Vec<u32>,
    ) {
        if self.task.is_some() {
            return;
        }
        self.task = Some(tokio::spawn(async move {
            let ctx = UploadCtx {
                api_base: &ctx_api_base,
                user_id: &ctx_user_id,
                api_key: &ctx_api_key,
                key: &ctx_key,
                upload_id: &ctx_upload_id,
            };
            multipart_part_urls(&ctx, &part_numbers).await
        }));
    }

    /// Espera la tarea en vuelo y vuelca las URLs obtenidas en el caché.
    ///
    /// Si la tarea falló, el error se registra pero no se propaga: el llamador
    /// volverá a pedir las URLs de forma bloqueante en la siguiente iteración.
    async fn drain_into_cache(&mut self, cache: &mut HashMap<u32, String>) {
        if let Some(task) = self.task.take() {
            match task.await {
                Ok(Ok(urls)) => {
                    for (n, u) in urls {
                        cache.insert(n, u);
                    }
                }
                Ok(Err(e)) => {
                    sync_logger::log_operation("prefetch_urls_error", &e);
                }
                Err(e) => {
                    sync_logger::log_operation("prefetch_task_panic", &e.to_string());
                }
            }
        }
    }

    /// Indica si hay una tarea de prefetch en vuelo actualmente.
    fn is_running(&self) -> bool {
        self.task.is_some()
    }
}

/// Garantiza que la URL de `part_number` esté en caché, solicitando el batch
/// necesario de forma bloqueante si no está disponible. Lanza el prefetch
/// especulativo del siguiente batch como tarea en background cuando el caché
/// cae por debajo de `prefetch_threshold`.
async fn ensure_part_url_cached(
    cache: &mut HashMap<u32, String>,
    prefetch: &mut PrefetchState,
    ctx: &UploadCtx<'_>,
    part_number: u32,
    prefetch_threshold: u32,
) -> Result<(), String> {
    // Incorporar el resultado del prefetch en vuelo antes de comprobar el caché,
    // para evitar pedir URLs que el prefetch ya está trayendo.
    prefetch.drain_into_cache(cache).await;

    if !cache.contains_key(&part_number) {
        // Fetch bloqueante: la URL es necesaria ahora y no está en caché.
        let batch_end = part_number.saturating_add(PART_URL_BATCH - 1);
        let part_numbers: Vec<u32> = (part_number..=batch_end).collect();
        let urls = with_retry(|| multipart_part_urls(ctx, &part_numbers)).await?;
        for (n, u) in urls {
            cache.insert(n, u);
        }
    }

    // Lanzar prefetch especulativo en background cuando el caché está cerca de agotarse.
    // Solo se lanza si no hay ya una tarea en vuelo y si hay partes por delante
    // que no están en caché.
    let available_ahead = cache.keys().filter(|&&k| k >= part_number).count() as u32;
    if available_ahead < prefetch_threshold && !prefetch.is_running() {
        let next_start = part_number + available_ahead;
        let next_end = next_start.saturating_add(PART_URL_BATCH - 1);
        let missing: Vec<u32> = (next_start..=next_end)
            .filter(|n| !cache.contains_key(n))
            .collect();
        if !missing.is_empty() {
            prefetch.launch(
                ctx.key.to_string(),
                ctx.upload_id.to_string(),
                ctx.api_base.to_string(),
                ctx.user_id.to_string(),
                ctx.api_key.to_string(),
                missing,
            );
        }
    }

    Ok(())
}

/// Resultado normalizado de una tarea de subida de parte.
enum TaskResult {
    Part {
        part_number: u32,
        etag: String,
        bytes_sent: u64,
        elapsed_ms: u128,
        /// Permiso del semáforo de memoria. Se dropea aquí para liberar el slot
        /// de memoria en cuanto la parte confirma subida exitosa.
        _permit: tokio::sync::OwnedSemaphorePermit,
    },
    Err(String),
}

/// Normaliza el resultado de `JoinSet::join_next` absorbiendo panics del runtime.
fn normalize_join_result(
    res: Result<
        PartTaskOutput,
        tokio::task::JoinError,
    >,
) -> TaskResult {
    match res {
        Ok(Ok((pn, etag, bytes_sent, elapsed_ms, permit))) => TaskResult::Part {
            part_number: pn,
            etag,
            bytes_sent,
            elapsed_ms,
            _permit: permit,
        },
        Ok(Err(e)) => TaskResult::Err(e),
        Err(e) => TaskResult::Err(format!("fallo critico en tarea de subida: {}", e)),
    }
}

/// Drena todas las tareas pendientes del JoinSet esperando su finalización.
/// En caso de error cancela el resto y llama a `multipart_abort`.
async fn drain_upload_tasks(
    tasks: &mut UploadJoinSet,
    ctx: &UploadCtx<'_>,
) -> Result<Vec<(u32, String, u64, u128)>, String> {
    let mut collected = Vec::new();
    while let Some(res) = tasks.join_next().await {
        match normalize_join_result(res) {
            TaskResult::Part {
                part_number,
                etag,
                bytes_sent,
                elapsed_ms,
                ..
            } => {
                collected.push((part_number, etag, bytes_sent, elapsed_ms));
            }
            TaskResult::Err(e) => {
                tasks.abort_all();
                let _ = multipart_abort(ctx).await;
                return Err(e);
            }
        }
    }
    Ok(collected)
}

/// Recoge sin bloquear las tareas que ya finalizaron.
/// Actualiza `completed_parts`, `uploaded_bytes` y alimenta el `ConcurrencyController`.
/// Devuelve los bytes recién completados (comprimidos) para métricas.
async fn collect_finished_tasks(
    tasks: &mut UploadJoinSet,
    ctx: &UploadCtx<'_>,
    completed_parts: &mut Vec<(u32, String)>,
    uploaded_bytes: &mut u64,
    concurrency: &mut ConcurrencyController,
) -> Result<u64, String> {
    let mut newly_uploaded: u64 = 0;
    while let Some(res) = tasks.try_join_next() {
        match normalize_join_result(res) {
            TaskResult::Part {
                part_number,
                etag,
                bytes_sent,
                elapsed_ms,
                ..
            } => {
                completed_parts.push((part_number, etag));
                *uploaded_bytes += bytes_sent;
                newly_uploaded += bytes_sent;
                concurrency.record_part(bytes_sent, elapsed_ms);
            }
            TaskResult::Err(e) => {
                tasks.abort_all();
                let _ = multipart_abort(ctx).await;
                return Err(e);
            }
        }
    }
    Ok(newly_uploaded)
}

/// Espera a que un slot de concurrencia se libere cuando el JoinSet está lleno.
async fn wait_for_one_slot(
    tasks: &mut UploadJoinSet,
    ctx: &UploadCtx<'_>,
    completed_parts: &mut Vec<(u32, String)>,
    uploaded_bytes: &mut u64,
    concurrency: &mut ConcurrencyController,
) -> Result<u64, String> {
    if tasks.len() < concurrency.current() {
        return Ok(0);
    }
    if let Some(res) = tasks.join_next().await {
        match normalize_join_result(res) {
            TaskResult::Part {
                part_number,
                etag,
                bytes_sent,
                elapsed_ms,
                ..
            } => {
                completed_parts.push((part_number, etag));
                *uploaded_bytes += bytes_sent;
                concurrency.record_part(bytes_sent, elapsed_ms);
                return Ok(bytes_sent);
            }
            TaskResult::Err(e) => {
                tasks.abort_all();
                let _ = multipart_abort(ctx).await;
                return Err(e);
            }
        }
    }
    Ok(0)
}

/// Emite un evento de progreso al frontend si el porcentaje entero ha cambiado
/// o si `force` es `true`. Devuelve el último porcentaje emitido.
///
/// El throttle por porcentaje entero evita inundar el IPC de Tauri con eventos
/// mientras el encoder TAR llena el buffer interno sin que la red avance.
fn maybe_emit_progress(
    app: &tauri::AppHandle,
    game_id: &str,
    filename: &str,
    loaded: u64,
    total: u64,
    last_pct: &mut u8,
    force: bool,
) {
    let pct = (loaded * 100)
        .checked_div(total)
        .map_or(0, |v| v.min(100) as u8);
    if force || pct > *last_pct {
        *last_pct = pct;
        emit_sync_upload_progress(
            app,
            SyncProgressPayload {
                operation_id: Some(format!("sync-upload-{}", game_id)),
                status: Some("running".to_string()),
                game_id: game_id.to_string(),
                filename: filename.to_string(),
                loaded,
                total,
                downloaded_bytes: Some(loaded),
                total_bytes: Some(total),
                can_pause: Some(false),
                can_cancel: Some(true),
                can_resume: None,
                strategy: Some(SyncOperationStrategy::Streaming),
                state: None,
                reason_code: None,
            },
        );
    }
}

/// Lanza la subida de una parte adquiriendo un permiso del semáforo de memoria.
///
/// El permiso se pasa dentro de la tarea y se dropea solo cuando la parte
/// confirma subida exitosa, liberando el slot de memoria en el momento correcto.
/// Esto garantiza que el número de partes en vuelo × `part_size` nunca supera
/// `strategy.max_inflight_bytes` independientemente de la concurrencia del JoinSet.
async fn spawn_part_upload(
    tasks: &mut UploadJoinSet,
    semaphore: &std::sync::Arc<Semaphore>,
    url: String,
    part_number: u32,
    bytes_to_send: bytes::Bytes,
) -> Result<(), String> {
    // Adquirir el permiso antes de encolar la tarea para que el backpressure
    // se aplique aquí (en el loop principal) y no dentro de la tarea.
    let permit = semaphore
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| "semaforo de memoria cerrado inesperadamente".to_string())?;

    let pn = part_number;
    tasks.spawn(async move {
        let result = with_retry(|| {
            let url = url.clone();
            let b = bytes_to_send.clone();
            async move { put_part(url, pn, b).await }
        })
        .await;
        // Adjuntar el permiso al resultado para que se dropee al procesar la tarea.
        result.map(|(pn, etag, bytes, ms)| (pn, etag, bytes, ms, permit))
    });

    Ok(())
}

/// Sube un archivo a S3 mediante multipart upload en modo streaming.
///
/// Lee chunks del receptor TAR, los acumula en un `BytesMut` hasta completar
/// una parte, y la sube concurrentemente con las demás. La concurrencia se
/// ajusta automáticamente según el throughput medido por `ConcurrencyController`.
/// Un semáforo de memoria impide que el número de partes en vuelo supere
/// `strategy.max_inflight_bytes`.
#[expect(
    clippy::too_many_arguments,
    reason = "Parámetros de streaming, backend API, handles de Tauri y tokens de cancelación"
)]
pub(crate) async fn upload_tar_stream_multipart(
    mut rx: tokio::sync::mpsc::Receiver<TarStreamMsg>,
    game_id: &str,
    relative_filename: &str,
    estimated_total: u64,
    api_base: &str,
    user_id: &str,
    api_key: &str,
    app: tauri::AppHandle,
    cancel: Option<std::sync::Arc<crate::tray::tray_state::TrayStateInner>>,
    shutdown_token: Option<tokio_util::sync::CancellationToken>,
) -> Result<(), String> {
    let strategy = UploadStrategy::for_file(estimated_total);
    let mut concurrency = ConcurrencyController::new(&strategy);

    // Semáforo de memoria: `max_inflight_bytes / part_size` permisos disponibles.
    // Limita la presión de memoria sin depender solo de la concurrencia del JoinSet.
    let max_permits = (strategy.max_inflight_bytes / strategy.part_size).max(1);
    let semaphore = std::sync::Arc::new(Semaphore::new(max_permits));

    let (upload_id, key) =
        with_retry(|| multipart_init(api_base, user_id, api_key, game_id, relative_filename))
            .await?;

    let ctx = UploadCtx {
        api_base,
        user_id,
        api_key,
        key: &key,
        upload_id: &upload_id,
    };
    let display_name = format!("{} (stream)", relative_filename);
    let log_ctx = format!(
        "gameId={} filename={} (streaming) strategy=[{}]",
        game_id,
        relative_filename,
        strategy.describe(),
    );
    sync_logger::log_operation("full_backup_streaming_start", &log_ctx);

    let mut part_urls_cache: HashMap<u32, String> = HashMap::new();
    let mut prefetch = PrefetchState::new();
    let mut part_number: u32 = 1;

    // `BytesMut` como buffer de acumulación de partes. `split_to(part_size).freeze()`
    // separa el chunk en O(1) sin mover bytes; el buffer continúa apuntando al
    // espacio contiguo restante del mismo bloque de memoria.
    let mut part_buf = BytesMut::with_capacity(strategy.part_size);

    let mut completed_parts: Vec<(u32, String)> = Vec::new();
    let mut uploaded_bytes: u64 = 0;
    let mut last_pct: u8 = 0;

    let mut upload_tasks: UploadJoinSet = tokio::task::JoinSet::new();

    maybe_emit_progress(
        &app,
        game_id,
        &display_name,
        0,
        estimated_total,
        &mut last_pct,
        true,
    );

    while let Some(msg) = rx.recv().await {
        if let Some(ref t) = cancel {
            if t.upload_cancel_requested() {
                upload_tasks.abort_all();
                let _ = multipart_abort(&ctx).await;
                return Err("subida cancelada".to_string());
            }
            if t.upload_pause_requested() {
                upload_tasks.abort_all();
                let _ = multipart_abort(&ctx).await;
                return Err("pausa no soportada en backups streaming (usa cancelar)".to_string());
            }
        }

        if let Some(ref token) = shutdown_token {
            if token.is_cancelled() {
                upload_tasks.abort_all();
                let _ = multipart_abort(&ctx).await;
                sync_logger::log_operation("full_backup_streaming_aborted_shutdown", &log_ctx);
                return Err("subida abortada por cierre de la aplicación".to_string());
            }
        }

        let _newly_uploaded = collect_finished_tasks(
            &mut upload_tasks,
            &ctx,
            &mut completed_parts,
            &mut uploaded_bytes,
            &mut concurrency,
        )
        .await?;

        match msg {
            TarStreamMsg::Chunk(bytes, original_processed) => {
                // Emitir progreso basado en los bytes crudos procesados (lectura disco/empaquetado).
                // Esto garantiza que la barra llegue al 100% independientemente del ratio de compresión.
                maybe_emit_progress(
                    &app,
                    game_id,
                    &display_name,
                    original_processed,
                    estimated_total,
                    &mut last_pct,
                    false,
                );

                let mut offset = 0usize;
                while offset < bytes.len() {
                    let space = strategy.part_size - part_buf.len();
                    let take = space.min(bytes.len() - offset);
                    part_buf.put_slice(&bytes[offset..offset + take]);
                    offset += take;

                    if part_buf.len() == strategy.part_size {
                        ensure_part_url_cached(
                            &mut part_urls_cache,
                            &mut prefetch,
                            &ctx,
                            part_number,
                            strategy.prefetch_threshold,
                        )
                        .await?;

                        let url = part_urls_cache
                            .remove(&part_number)
                            .ok_or_else(|| format!("falta URL para parte {}", part_number))?;

                        // `split_to(part_size).freeze()` separa el chunk del buffer en O(1).
                        // `Bytes::clone` es O(1) (Arc interno), seguro en el closure de retry.
                        let bytes_to_send = part_buf.split_to(strategy.part_size).freeze();

                        let _slot_bytes = wait_for_one_slot(
                            &mut upload_tasks,
                            &ctx,
                            &mut completed_parts,
                            &mut uploaded_bytes,
                            &mut concurrency,
                        )
                        .await?;

                        spawn_part_upload(
                            &mut upload_tasks,
                            &semaphore,
                            url,
                            part_number,
                            bytes_to_send,
                        )
                        .await?;

                        part_number += 1;
                    }
                }
            }
            TarStreamMsg::Err(e) => {
                upload_tasks.abort_all();
                let _ = multipart_abort(&ctx).await;
                sync_logger::log_error("full_backup_streaming_error", &log_ctx, &e);
                return Err(e);
            }
            TarStreamMsg::Done(_) => break,
        }
    }

    // Subir la última parte si quedaron bytes sin enviar (tamaño < part_size).
    if !part_buf.is_empty() {
        ensure_part_url_cached(
            &mut part_urls_cache,
            &mut prefetch,
            &ctx,
            part_number,
            strategy.prefetch_threshold,
        )
        .await?;

        let url = part_urls_cache
            .remove(&part_number)
            .ok_or_else(|| format!("falta URL para parte {}", part_number))?;

        let bytes_to_send = part_buf.split_to(part_buf.len()).freeze();
        spawn_part_upload(
            &mut upload_tasks,
            &semaphore,
            url,
            part_number,
            bytes_to_send,
        )
        .await?;
    }

    // Drenar todas las tareas restantes propagando cualquier error.
    let remaining = drain_upload_tasks(&mut upload_tasks, &ctx).await?;
    for (pn, etag, bytes_sent, elapsed_ms) in remaining {
        completed_parts.push((pn, etag));
        uploaded_bytes += bytes_sent;
        concurrency.record_part(bytes_sent, elapsed_ms);
    }

    // Emit final forzado al 100% una vez el TAR termina.
    maybe_emit_progress(
        &app,
        game_id,
        &display_name,
        estimated_total,
        estimated_total,
        &mut last_pct,
        true,
    );

    completed_parts.sort_by_key(|p| p.0);
    with_retry(|| multipart_complete(&ctx, &completed_parts)).await?;

    let ctx_stats = format!(
        "{} | original_mb={:.1} uploaded_mb={:.1} ratio={:.2}x concurrency=[{}]",
        log_ctx,
        estimated_total as f64 / (1024.0 * 1024.0),
        uploaded_bytes as f64 / (1024.0 * 1024.0),
        if uploaded_bytes > 0 {
            estimated_total as f64 / uploaded_bytes as f64
        } else {
            1.0
        },
        concurrency.describe(),
    );
    sync_logger::log_operation("full_backup_streaming_complete", &ctx_stats);

    Ok(())
}

/// Métricas detalladas recopiladas al finalizar una prueba de streaming TAR (dry-run).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingDryRunMetrics {
    pub game_id: String,
    pub filename: String,
    pub original_bytes: u64,
    pub compressed_bytes: u64,
    pub saved_bytes: u64,
    pub saved_ratio: f64,
    pub saved_percentage: f64,
    pub duration_ms: u64,
    pub throughput_mb_s: f64,
    pub output_throughput_mb_s: f64,
    pub zstd_level: i32,
    pub threads: u32,
    pub total_files: u64,
    pub total_dirs: u64,
    pub total_symlinks: u64,
    pub chunks_count: u64,
    pub simulated_part_size: usize,
    pub simulated_parts_count: u32,
}

/// Ejecuta una simulación de subida sin tocar el API ni S3, midiendo el impacto comprimido.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn upload_tar_stream_multipart_dry_run(
    mut rx: tokio::sync::mpsc::Receiver<TarStreamMsg>,
    game_id: &str,
    relative_filename: &str,
    estimated_total: u64,
    zstd_compression_level: i32,
    app: tauri::AppHandle,
    cancel: Option<std::sync::Arc<crate::tray::tray_state::TrayStateInner>>,
    shutdown_token: Option<tokio_util::sync::CancellationToken>,
) -> Result<StreamingDryRunMetrics, String> {
    let strategy = UploadStrategy::for_file(estimated_total);
    let display_name = format!("{} (stream dry-run)", relative_filename);
    let log_ctx = format!(
        "gameId={} filename={} (streaming dry-run) strategy=[{}] zstd={}",
        game_id,
        relative_filename,
        strategy.describe(),
        zstd_compression_level,
    );
    sync_logger::log_operation("full_backup_streaming_dry_run_start", &log_ctx);

    let start_time = Instant::now();
    let mut uploaded_bytes: u64 = 0;
    let mut chunks_count: u64 = 0;
    let mut last_pct: u8 = 0;
    let mut stats = TarStreamStats::default();

    maybe_emit_progress(
        &app,
        game_id,
        &display_name,
        0,
        estimated_total,
        &mut last_pct,
        true,
    );

    while let Some(msg) = rx.recv().await {
        if let Some(ref t) = cancel {
            if t.upload_cancel_requested() {
                let ctx = format!("{} | cancelled_after_bytes={}", log_ctx, uploaded_bytes);
                sync_logger::log_operation("full_backup_streaming_dry_run_cancelled", &ctx);
                return Err("subida de prueba cancelada".to_string());
            }
        }

        if let Some(ref token) = shutdown_token {
            if token.is_cancelled() {
                sync_logger::log_operation(
                    "full_backup_streaming_dry_run_aborted_shutdown",
                    &log_ctx,
                );
                return Err("subida de prueba abortada por cierre de la aplicación".to_string());
            }
        }

        match msg {
            TarStreamMsg::Chunk(bytes, original_processed) => {
                uploaded_bytes += bytes.len() as u64;
                chunks_count += 1;

                maybe_emit_progress(
                    &app,
                    game_id,
                    &display_name,
                    original_processed,
                    estimated_total,
                    &mut last_pct,
                    false,
                );
            }
            TarStreamMsg::Err(e) => {
                sync_logger::log_error("full_backup_streaming_dry_run_error", &log_ctx, &e);
                return Err(e);
            }
            TarStreamMsg::Done(tar_stats) => {
                stats = tar_stats;
                break;
            }
        }
    }

    // Emit final forzado para garantizar que el frontend refleja el 100%.
    maybe_emit_progress(
        &app,
        game_id,
        &display_name,
        estimated_total,
        estimated_total,
        &mut last_pct,
        true,
    );

    let elapsed = start_time.elapsed();
    let duration_ms = elapsed.as_millis() as u64;
    let duration_secs = elapsed.as_secs_f64().max(0.001);

    let original_bytes = if stats.uncompressed_bytes > 0 {
        stats.uncompressed_bytes
    } else {
        estimated_total
    };
    let compressed_bytes = uploaded_bytes;
    let saved_bytes = original_bytes.saturating_sub(compressed_bytes);
    let saved_ratio = if compressed_bytes > 0 {
        original_bytes as f64 / compressed_bytes as f64
    } else {
        1.0
    };
    let saved_percentage = if original_bytes > 0 {
        ((saved_bytes as f64 / original_bytes as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    let throughput_mb_s = (original_bytes as f64 / (1024.0 * 1024.0)) / duration_secs;
    let output_throughput_mb_s = (compressed_bytes as f64 / (1024.0 * 1024.0)) / duration_secs;
    let simulated_part_size = strategy.part_size;
    let simulated_parts_count = if compressed_bytes == 0 {
        1
    } else {
        compressed_bytes.div_ceil(simulated_part_size as u64) as u32
    };
    let threads = (num_cpus::get() - 1).max(1) as u32;

    let metrics = StreamingDryRunMetrics {
        game_id: game_id.to_string(),
        filename: relative_filename.to_string(),
        original_bytes,
        compressed_bytes,
        saved_bytes,
        saved_ratio,
        saved_percentage,
        duration_ms,
        throughput_mb_s,
        output_throughput_mb_s,
        zstd_level: zstd_compression_level,
        threads,
        total_files: stats.files_count,
        total_dirs: stats.dirs_count,
        total_symlinks: stats.symlinks_count,
        chunks_count,
        simulated_part_size,
        simulated_parts_count,
    };

    // Emitir evento Tauri dedicado al frontend con las métricas completas
    crate::commands::sync::events::emit_streaming_dry_run_completed(&app, &metrics);

    let final_ctx = format!(
        "{} | original_mb={:.2} compressed_mb={:.2} saved_mb={:.2} ({:.1}%) ratio={:.2}x throughput={:.1}MB/s duration={}ms files={}",
        log_ctx,
        original_bytes as f64 / (1024.0 * 1024.0),
        compressed_bytes as f64 / (1024.0 * 1024.0),
        saved_bytes as f64 / (1024.0 * 1024.0),
        saved_percentage,
        saved_ratio,
        throughput_mb_s,
        duration_ms,
        stats.files_count,
    );
    sync_logger::log_operation("full_backup_streaming_dry_run_complete", &final_ctx);

    Ok(metrics)
}

/// Sube una parte a S3 mediante PUT y devuelve número de parte, ETag,
/// bytes enviados y tiempo transcurrido en milisegundos.
///
/// El tiempo se usa en `ConcurrencyController` para calcular el throughput real.
/// `Content-Length` se incluye explícitamente porque S3 lo requiere en PUTs
/// de partes multipart; `reqwest` lo deriva del tamaño del `Bytes` automáticamente.
async fn put_part(
    url: String,
    part_number: u32,
    bytes: bytes::Bytes,
) -> Result<(u32, String, u64, u128), String> {
    let len = bytes.len() as u64;
    let start = Instant::now();

    let res = DATA_CLIENT
        .put(&url)
        .body(bytes)
        .header("Content-Type", "application/octet-stream")
        .send()
        .await
        .map_err(|e| format!("PUT parte {}: {}", part_number, e))?;

    if !res.status().is_success() {
        return Err(format!("parte {}: S3 PUT {}", part_number, res.status()));
    }

    let elapsed_ms = start.elapsed().as_millis();
    let throughput_mbps = if elapsed_ms > 0 {
        (len as f64 * 8.0) / (elapsed_ms as f64 / 1000.0) / 1_000_000.0
    } else {
        0.0
    };

    sync_logger::log_operation(
        "put_part_timing",
        &format!(
            "part={} size_mb={:.1} elapsed_ms={} throughput_mbps={:.1}",
            part_number,
            len as f64 / (1024.0 * 1024.0),
            elapsed_ms,
            throughput_mbps,
        ),
    );

    let etag = res
        .headers()
        .get("etag")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    Ok((part_number, etag, len, elapsed_ms))
}
