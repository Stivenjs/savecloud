use std::collections::HashMap;
use std::sync::LazyLock;

use tauri::Emitter;

use super::super::api;
use super::super::models::SyncProgressPayload;
use super::super::sync_logger;
use super::tar_stream::TarStreamMsg;

/// Debe ser >= 5 MiB excepto última parte.
/// Usamos 32 MiB para reducir el número de partes en backups grandes.
const PART_SIZE: usize = 32 * 1024 * 1024;
const PART_URL_BATCH: u32 = 100;
const MAX_RETRIES: u32 = 3;
const RETRY_DELAY_SECS: u64 = 1;
/// Límite de partes subiéndose al mismo tiempo.
/// 4 partes de 32MB = ~128MB de RAM en uso. Evita agotar la memoria en PCs con internet lento.
const MAX_CONCURRENT_PARTS: usize = 4;

static S3_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("SaveCloud-desktop/1.0")
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .expect("Fallo al construir cliente HTTP S3")
});

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
        return Err(format!("API multipart/init: {} {}", status, text));
    }
    let parsed: MultipartInitResponse = res.json().await.map_err(|e| e.to_string())?;
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
    let body = PartUrlsRequest {
        key: key.to_string(),
        upload_id: upload_id.to_string(),
        part_numbers: part_numbers.to_vec(),
    };
    let body_bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
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
        return Err(format!("API multipart/part-urls: {} {}", status, text));
    }
    let parsed: PartUrlsResponse = res.json().await.map_err(|e| e.to_string())?;
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
    let body_bytes = serde_json::to_vec(&body).map_err(|e| e.to_string())?;
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
        return Err(format!("API multipart/abort: {} {}", status, text));
    }
    Ok(())
}

async fn ensure_part_urls_cached(
    cache: &mut HashMap<u32, String>,
    api_base: &str,
    user_id: &str,
    api_key: &str,
    key: &str,
    upload_id: &str,
    part_number: u32,
) -> Result<(), String> {
    if cache.contains_key(&part_number) {
        return Ok(());
    }
    let batch_end = part_number.saturating_add(PART_URL_BATCH - 1);
    let part_numbers: Vec<u32> = (part_number..=batch_end).collect();
    let urls = with_retry(|| {
        multipart_part_urls(api_base, user_id, api_key, key, upload_id, &part_numbers)
    })
    .await?;
    for (n, u) in urls {
        cache.insert(n, u);
    }
    Ok(())
}

async fn put_part(
    url: String,
    part_number: u32,
    bytes: bytes::Bytes,
) -> Result<(u32, String, u64), String> {
    let len = bytes.len() as u64;
    let res = S3_CLIENT
        .put(&url)
        .body(bytes)
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
    Ok((part_number, etag, len))
}

/// Sube un backup completo en modo streaming:
/// - genera TAR por canal
/// - hace multipart sin guardar .tar en disco de forma CONCURRENTE
pub(crate) async fn upload_tar_stream_multipart(
    mut rx: tokio::sync::mpsc::Receiver<TarStreamMsg>,
    game_id: &str,
    relative_filename: &str,
    estimated_total: u64,
    api_base: &str,
    user_id: &str,
    api_key: &str,
    app: tauri::AppHandle,
    cancel: Option<std::sync::Arc<crate::tray_state::TrayStateInner>>,
) -> Result<(), String> {
    let (upload_id, key) =
        with_retry(|| multipart_init(api_base, user_id, api_key, game_id, relative_filename))
            .await?;
    let ctx = format!(
        "gameId={} filename={} (streaming)",
        game_id, relative_filename
    );
    sync_logger::log_operation("full_backup_streaming_start", &ctx);

    let mut part_urls_cache: HashMap<u32, String> = HashMap::new();
    let mut part_number: u32 = 1;
    let mut part_buf: Vec<u8> = Vec::with_capacity(PART_SIZE);

    let mut completed_parts: Vec<(u32, String)> = Vec::new();
    let mut loaded: u64 = 0;

    // JoinSet para manejar subidas concurrentes
    let mut upload_tasks = tokio::task::JoinSet::new();

    let _ = app.emit(
        "sync-upload-progress",
        SyncProgressPayload {
            game_id: game_id.to_string(),
            filename: format!("{} (stream)", relative_filename),
            loaded: 0,
            total: estimated_total,
        },
    );

    while let Some(msg) = rx.recv().await {
        // Verificar cancelaciones
        if let Some(ref t) = cancel {
            if t.upload_cancel_requested() {
                upload_tasks.abort_all(); // Detenemos las subidas en curso
                let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
                return Err("Subida cancelada".to_string());
            }
            if t.upload_pause_requested() {
                upload_tasks.abort_all();
                let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
                return Err("Pausa no soportada en backups streaming (usa Cancelar).".to_string());
            }
        }

        // Manejar errores en las tareas concurrentes que ya terminaron
        while let Some(res) = upload_tasks.try_join_next() {
            match res {
                Ok(Ok((pn, etag, bytes_sent))) => {
                    completed_parts.push((pn, etag));
                    loaded += bytes_sent;
                    let _ = app.emit(
                        "sync-upload-progress",
                        SyncProgressPayload {
                            game_id: game_id.to_string(),
                            filename: format!("{} (stream)", relative_filename),
                            loaded,
                            total: estimated_total,
                        },
                    );
                }
                Ok(Err(e)) => {
                    upload_tasks.abort_all();
                    let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
                    return Err(e);
                }
                Err(e) => {
                    upload_tasks.abort_all();
                    let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
                    return Err(format!("Fallo crítico en hilo de subida: {}", e));
                }
            }
        }

        match msg {
            TarStreamMsg::Chunk(bytes) => {
                let mut offset = 0usize;
                while offset < bytes.len() {
                    let remaining = PART_SIZE - part_buf.len();
                    let take = std::cmp::min(remaining, bytes.len() - offset);
                    part_buf.extend_from_slice(&bytes[offset..offset + take]);
                    offset += take;

                    if part_buf.len() == PART_SIZE {
                        ensure_part_urls_cached(
                            &mut part_urls_cache,
                            api_base,
                            user_id,
                            api_key,
                            &key,
                            &upload_id,
                            part_number,
                        )
                        .await?;

                        let url = part_urls_cache
                            .get(&part_number)
                            .cloned()
                            .ok_or_else(|| format!("Falta URL para parte {}", part_number))?;

                        let bytes_to_send = bytes::Bytes::from(std::mem::take(&mut part_buf));
                        part_buf = Vec::with_capacity(PART_SIZE);

                        // Si hemos alcanzado el límite de concurrencia, esperamos a que termine una parte
                        if upload_tasks.len() >= MAX_CONCURRENT_PARTS {
                            if let Some(res) = upload_tasks.join_next().await {
                                match res {
                                    Ok(Ok((pn, etag, bytes_sent))) => {
                                        completed_parts.push((pn, etag));
                                        loaded += bytes_sent;
                                        let _ = app.emit(
                                            "sync-upload-progress",
                                            SyncProgressPayload {
                                                game_id: game_id.to_string(),
                                                filename: format!("{} (stream)", relative_filename),
                                                loaded,
                                                total: estimated_total,
                                            },
                                        );
                                    }
                                    Ok(Err(e)) => {
                                        upload_tasks.abort_all();
                                        let _ = multipart_abort(
                                            api_base, user_id, api_key, &key, &upload_id,
                                        )
                                        .await;
                                        return Err(e);
                                    }
                                    Err(e) => {
                                        upload_tasks.abort_all();
                                        let _ = multipart_abort(
                                            api_base, user_id, api_key, &key, &upload_id,
                                        )
                                        .await;
                                        return Err(format!("Fallo de hilo: {}", e));
                                    }
                                }
                            }
                        }

                        // Lanzamos la subida de la parte actual al hilo en segundo plano
                        let pn_clone = part_number;
                        upload_tasks.spawn(async move {
                            with_retry(|| put_part(url.clone(), pn_clone, bytes_to_send.clone()))
                                .await
                        });

                        part_number += 1;
                    }
                }
            }
            TarStreamMsg::Err(e) => {
                upload_tasks.abort_all();
                let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
                sync_logger::log_error("full_backup_streaming_error", &ctx, &e);
                return Err(e);
            }
            TarStreamMsg::Done => break,
        }
    }

    // Procesar la última parte si quedó algo en el buffer
    if !part_buf.is_empty() {
        ensure_part_urls_cached(
            &mut part_urls_cache,
            api_base,
            user_id,
            api_key,
            &key,
            &upload_id,
            part_number,
        )
        .await?;

        let url = part_urls_cache
            .get(&part_number)
            .cloned()
            .ok_or_else(|| format!("Falta URL para parte {}", part_number))?;

        let bytes_to_send = bytes::Bytes::from(std::mem::take(&mut part_buf));

        upload_tasks.spawn(async move {
            with_retry(|| put_part(url.clone(), part_number, bytes_to_send.clone())).await
        });
    }

    // Esperar a que terminen todas las subidas en curso
    while let Some(res) = upload_tasks.join_next().await {
        match res {
            Ok(Ok((pn, etag, bytes_sent))) => {
                completed_parts.push((pn, etag));
                loaded += bytes_sent;
                let _ = app.emit(
                    "sync-upload-progress",
                    SyncProgressPayload {
                        game_id: game_id.to_string(),
                        filename: format!("{} (stream)", relative_filename),
                        loaded,
                        total: estimated_total,
                    },
                );
            }
            Ok(Err(e)) => {
                upload_tasks.abort_all();
                let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
                return Err(e);
            }
            Err(e) => {
                upload_tasks.abort_all();
                let _ = multipart_abort(api_base, user_id, api_key, &key, &upload_id).await;
                return Err(format!("Fallo crítico al finalizar hilos: {}", e));
            }
        }
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

    let final_ctx = format!("{} | parts={} bytes={}", ctx, completed_parts.len(), loaded);
    sync_logger::log_operation("full_backup_streaming_complete", &final_ctx);

    Ok(())
}

/// Dry-run: consume el stream de TAR y emite progreso sin subir a la nube.
pub(crate) async fn upload_tar_stream_multipart_dry_run(
    mut rx: tokio::sync::mpsc::Receiver<TarStreamMsg>,
    game_id: &str,
    relative_filename: &str,
    estimated_total: u64,
    app: tauri::AppHandle,
    cancel: Option<std::sync::Arc<crate::tray_state::TrayStateInner>>,
) -> Result<(), String> {
    let ctx = format!(
        "gameId={} filename={} (streaming dry-run)",
        game_id, relative_filename
    );
    sync_logger::log_operation("full_backup_streaming_dry_run_start", &ctx);

    let mut loaded: u64 = 0;
    let _ = app.emit(
        "sync-upload-progress",
        SyncProgressPayload {
            game_id: game_id.to_string(),
            filename: format!("{} (stream dry-run)", relative_filename),
            loaded: 0,
            total: estimated_total,
        },
    );

    while let Some(msg) = rx.recv().await {
        if let Some(ref t) = cancel {
            if t.upload_cancel_requested() {
                let cancel_ctx = format!("{} | cancelled_after_bytes={}", ctx, loaded);
                sync_logger::log_operation("full_backup_streaming_dry_run_cancelled", &cancel_ctx);
                return Err("Subida de prueba cancelada".to_string());
            }
            if t.upload_pause_requested() {
                let pause_ctx = format!("{} | pause_requested_bytes={}", ctx, loaded);
                sync_logger::log_operation(
                    "full_backup_streaming_dry_run_pause_ignored",
                    &pause_ctx,
                );
            }
        }

        match msg {
            TarStreamMsg::Chunk(bytes) => {
                loaded += bytes.len() as u64;
                let _ = app.emit(
                    "sync-upload-progress",
                    SyncProgressPayload {
                        game_id: game_id.to_string(),
                        filename: format!("{} (stream dry-run)", relative_filename),
                        loaded,
                        total: estimated_total,
                    },
                );
            }
            TarStreamMsg::Err(e) => {
                sync_logger::log_error("full_backup_streaming_dry_run_error", &ctx, &e);
                return Err(e);
            }
            TarStreamMsg::Done => break,
        }
    }

    let final_ctx = format!("{} | bytes={}", ctx, loaded);
    sync_logger::log_operation("full_backup_streaming_dry_run_complete", &final_ctx);
    Ok(())
}
