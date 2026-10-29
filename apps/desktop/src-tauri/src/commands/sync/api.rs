//! Cliente HTTP para la API de gestión de guardados.
//!
//! Encapsula la comunicación con el backend, proporcionando métodos
//! para interactuar con los endpoints relacionados con la sincronización
//! de archivos.
//!
//! Incluye configuración de timeouts, manejo de errores y soporte para
//! reintentos en solicitudes críticas.

use super::context::ApiContext;
use super::events::{emit_sync_download_progress, emit_sync_terminal};
use super::models::{
    CloudSavesSummaryDto, RemoteSaveDto, RemoteSaveInfoDto, SyncOperationStrategy,
    SyncProgressPayload, SyncResultDto,
};
use crate::cloud::api_error;
use crate::network::API_CLIENT;
use crate::observability;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::utils::transfer_metrics::{
    TransferProgressThrottle, TransferSample, TransferSpeedTracker, PACKAGED_PROGRESS_POLICY,
};

const S3_ACCELERATE_HOST: &str = "s3-accelerate.amazonaws.com";

static S3_ENDPOINT_CACHE: LazyLock<std::sync::RwLock<Option<String>>> =
    LazyLock::new(|| std::sync::RwLock::new(None));

#[derive(Clone)]
struct EtagCacheEntry<T> {
    etag: String,
    data: T,
}

static SAVES_CACHE: LazyLock<
    std::sync::RwLock<HashMap<String, EtagCacheEntry<Vec<RemoteSaveInfoDto>>>>,
> = LazyLock::new(|| std::sync::RwLock::new(HashMap::new()));

static SUMMARY_CACHE: LazyLock<
    std::sync::RwLock<HashMap<String, EtagCacheEntry<Vec<CloudSavesSummaryDto>>>>,
> = LazyLock::new(|| std::sync::RwLock::new(HashMap::new()));

/// Invalida la caché ETag en memoria para un usuario y opcionalmente un juego concreto.
/// Debe llamarse tras operaciones que modifiquen el estado en S3 (subida, borrado, renombrado).
pub fn invalidate_remote_saves_cache(user_id: &str, game_id: Option<&str>) {
    if let Ok(mut cache) = SAVES_CACHE.write() {
        if let Some(gid) = game_id {
            let key = format!("{user_id}::{gid}");
            cache.remove(&key);
            cache.retain(|k, _| !k.starts_with(&format!("{user_id}::")));
        } else {
            cache.retain(|k, _| !k.starts_with(user_id));
        }
    }
    if let Ok(mut cache) = SUMMARY_CACHE.write() {
        cache.remove(user_id);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UploadUrlItemRequest {
    game_id: String,
    filename: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadUrlResultItem {
    upload_url: String,
    #[serde(rename = "key")]
    _key: String,
    #[serde(rename = "gameId")]
    _game_id: String,
    filename: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadUrlsResponse {
    urls: Vec<UploadUrlResultItem>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadUrlItemRequest {
    game_id: String,
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadUrlResultItem {
    download_url: String,
    #[serde(rename = "gameId")]
    _game_id: String,
    #[serde(rename = "key")]
    key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadUrlsResponse {
    urls: Vec<DownloadUrlResultItem>,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopyFriendFilePlanDto {
    pub key: String,
    pub filename: String,
    pub target_filename: String,
    #[serde(default)]
    pub size: Option<u64>,
}

fn get_api_context() -> Result<ApiContext, String> {
    super::context::resolve_api_context()
}

pub(crate) async fn api_request_with_etag(
    base_url: &str,
    user_id: &str,
    api_key: &str,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
    if_none_match: Option<&str>,
) -> Result<reqwest::Response, String> {
    crate::cloud::session_refresh::ensure_active_guest_token_valid().await?;
    let url = format!("{}/saves{}", base_url.trim_end_matches('/'), path);
    let active_host = crate::config::load_settings()
        .active_cloud_host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let effective_api_key = if let Some(host) = active_host.as_deref() {
        crate::config::get_secure_api_key_for_cloud_host(host).unwrap_or_else(|| api_key.to_string())
    } else {
        api_key.to_string()
    };

    let method = reqwest::Method::from_bytes(method.as_bytes())
        .map_err(|error| format!("Método HTTP inválido '{method}': {error}"))?;
    let retry_safe = super::retry::is_safe_to_retry(&method, path);
    let max_attempts = if retry_safe { 3 } else { 1 };

    for attempt in 0..max_attempts {
        let mut req = API_CLIENT
            .request(method.clone(), &url)
            .header("x-user-id", user_id)
            .header("x-api-key", &effective_api_key);

        if let Some(etag) = if_none_match {
            req = req.header("If-None-Match", etag);
        }
        if let Some(host) = active_host.as_deref() {
            req = req.header("x-cloud-host-user-id", host);
        }
        if let Some(body) = body {
            req = req
                .header("Content-Type", "application/json")
                .body(body.to_vec());
        }

        let start = Instant::now();
        let response = match req.send().await {
            Ok(response) => response,
            Err(error) => {
                let can_retry = retry_safe
                    && attempt + 1 < max_attempts
                    && (error.is_timeout() || error.is_connect());
                if can_retry {
                    super::retry::wait_before_retry(attempt, None).await;
                    continue;
                }

                observability::record_error("sync_api_send", &error.to_string(), None);
                return Err(api_error::network_message());
            }
        };

        if retry_safe
            && attempt + 1 < max_attempts
            && super::retry::is_retryable_status(response.status())
        {
            super::retry::wait_before_retry(attempt, Some(response.headers())).await;
            continue;
        }

        let elapsed_ms = start.elapsed().as_millis() as u64;
        let status = response.status();
        let is_ok = status.is_success() || status == reqwest::StatusCode::NOT_MODIFIED;
        observability::record_saves_api_timing(elapsed_ms, is_ok, path);
        if !is_ok {
            let status_code = status.as_u16();
            observability::record_error(
                "sync_api_http",
                &format!("path={path} status={status_code}"),
                Some(status_code),
            );
        }
        return Ok(response);
    }

    Err(api_error::network_message())
}

pub(crate) async fn api_request(
    base_url: &str,
    user_id: &str,
    api_key: &str,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> Result<reqwest::Response, String> {
    api_request_with_etag(base_url, user_id, api_key, method, path, body, None).await
}

pub(crate) async fn get_upload_urls(
    base_url: &str,
    user_id: &str,
    api_key: &str,
    game_id: &str,
    filenames: &[String],
) -> Result<Vec<(String, String)>, String> {
    if filenames.is_empty() {
        return Ok(Vec::new());
    }
    let items: Vec<UploadUrlItemRequest> = filenames
        .iter()
        .map(|f| UploadUrlItemRequest {
            game_id: game_id.to_string(),
            filename: f.clone(),
        })
        .collect();

    let body = serde_json::json!({ "items": items }).to_string();

    let res = api_request(
        base_url,
        user_id,
        api_key,
        "POST",
        "/upload-urls",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("upload-urls: {}", e))?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }

    let parsed: UploadUrlsResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed
        .urls
        .into_iter()
        .map(|u| (u.upload_url, u.filename))
        .collect())
}

pub(crate) async fn get_download_urls(
    base_url: &str,
    user_id: &str,
    api_key: &str,
    items: &[(String, String)],
) -> Result<Vec<(String, String)>, String> {
    if items.is_empty() {
        return Ok(Vec::new());
    }
    let req_items: Vec<DownloadUrlItemRequest> = items
        .iter()
        .map(|(game_id, key)| DownloadUrlItemRequest {
            game_id: game_id.clone(),
            key: key.clone(),
        })
        .collect();

    let body = serde_json::json!({ "items": req_items }).to_string();

    let res = api_request(
        base_url,
        user_id,
        api_key,
        "POST",
        "/download-urls",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("download-urls: {}", e))?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }

    let parsed: DownloadUrlsResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(parsed
        .urls
        .into_iter()
        .map(|u| (u.download_url, u.key))
        .collect())
}

/// Lista guardados remotos. `target_user_id` distinto del autenticado usa `GET /saves?targetUserId=...`
/// con `x-user-id` = usuario autenticado (compatible con access token por usuario).
async fn list_remote_saves_for_user(
    api_base: &str,
    api_key: &str,
    authenticated_user_id: &str,
    target_user_id: Option<&str>,
) -> Result<Vec<RemoteSaveInfoDto>, String> {
    let path = match target_user_id {
        None => String::new(),
        Some(t) if t == authenticated_user_id => String::new(),
        Some(t) => format!("?targetUserId={}", urlencoding::encode(t)),
    };

    let cache_key = format!("{authenticated_user_id}::{target_user_id:?}");
    let cached_entry = SAVES_CACHE
        .read()
        .ok()
        .and_then(|c| c.get(&cache_key).cloned());

    let if_none_match = cached_entry.as_ref().map(|e| e.etag.as_str());

    let res = api_request_with_etag(
        api_base,
        authenticated_user_id,
        api_key,
        "GET",
        &path,
        None,
        if_none_match,
    )
    .await
    .map_err(|e| format!("GET /saves: {}", e))?;

    if res.status() == reqwest::StatusCode::NOT_MODIFIED {
        if let Some(entry) = cached_entry {
            return Ok(entry.data);
        }
    }

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }

    let etag_header = res
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let raw: Vec<RemoteSaveDto> = res.json().await.map_err(|e| e.to_string())?;
    let out: Vec<RemoteSaveInfoDto> = raw
        .into_iter()
        .map(|s| {
            let parts: Vec<&str> = s.key.split('/').collect();
            let filename = if parts.len() >= 3 {
                parts[2..].join("/")
            } else {
                s.key.clone()
            };
            RemoteSaveInfoDto {
                game_id: s.game_id,
                key: s.key,
                filename,
                last_modified: s.last_modified,
                size: s.size,
            }
        })
        .collect();

    if let Some(etag) = etag_header {
        if let Ok(mut cache) = SAVES_CACHE.write() {
            cache.insert(
                cache_key,
                EtagCacheEntry {
                    etag,
                    data: out.clone(),
                },
            );
        }
    }

    Ok(out)
}

async fn list_remote_saves_for_user_and_game(
    api_base: &str,
    api_key: &str,
    user_id: &str,
    game_id: &str,
) -> Result<Vec<RemoteSaveInfoDto>, String> {
    let trimmed_game_id = game_id.trim();
    if trimmed_game_id.is_empty() {
        return Err("gameId vacío".into());
    }

    let cache_key = format!("{user_id}::{trimmed_game_id}");
    let cached_entry = SAVES_CACHE
        .read()
        .ok()
        .and_then(|c| c.get(&cache_key).cloned());

    let if_none_match = cached_entry.as_ref().map(|e| e.etag.as_str());

    let path = format!("?gameId={}", urlencoding::encode(trimmed_game_id));
    let res = api_request_with_etag(
        api_base,
        user_id,
        api_key,
        "GET",
        &path,
        None,
        if_none_match,
    )
    .await
    .map_err(|e| format!("GET /saves?gameId: {}", e))?;

    if res.status() == reqwest::StatusCode::NOT_MODIFIED {
        if let Some(entry) = cached_entry {
            return Ok(entry.data);
        }
    }

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }

    let etag_header = res
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let raw: Vec<RemoteSaveDto> = res.json().await.map_err(|e| e.to_string())?;
    let out: Vec<RemoteSaveInfoDto> = raw
        .into_iter()
        .map(|s| {
            let parts: Vec<&str> = s.key.split('/').collect();
            let filename = if parts.len() >= 3 {
                parts[2..].join("/")
            } else {
                s.key.clone()
            };
            RemoteSaveInfoDto {
                game_id: s.game_id,
                key: s.key,
                filename,
                last_modified: s.last_modified,
                size: s.size,
            }
        })
        .collect();

    if let Some(etag) = etag_header {
        if let Ok(mut cache) = SAVES_CACHE.write() {
            cache.insert(
                cache_key,
                EtagCacheEntry {
                    etag,
                    data: out.clone(),
                },
            );
        }
    }

    Ok(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CloudSavesSummaryItem {
    game_id: String,
    file_count: u32,
    total_size_bytes: u64,
    last_modified: Option<String>,
}

async fn list_remote_saves_summary_for_user(
    api_base: &str,
    api_key: &str,
    user_id: &str,
) -> Result<Vec<CloudSavesSummaryDto>, String> {
    let cache_key = user_id.to_string();
    let cached_entry = SUMMARY_CACHE
        .read()
        .ok()
        .and_then(|c| c.get(&cache_key).cloned());

    let if_none_match = cached_entry.as_ref().map(|e| e.etag.as_str());

    let res = api_request_with_etag(
        api_base,
        user_id,
        api_key,
        "GET",
        "/summary",
        None,
        if_none_match,
    )
    .await
    .map_err(|e| format!("GET /saves/summary: {}", e))?;

    if res.status() == reqwest::StatusCode::NOT_MODIFIED {
        if let Some(entry) = cached_entry {
            return Ok(entry.data);
        }
    }

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }

    let etag_header = res
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|h| h.to_str().ok())
        .map(|s| s.to_string());

    let raw: Vec<CloudSavesSummaryItem> = res.json().await.map_err(|e| e.to_string())?;
    let out: Vec<CloudSavesSummaryDto> = raw
        .into_iter()
        .map(|s| CloudSavesSummaryDto {
            game_id: s.game_id,
            file_count: s.file_count,
            total_size_bytes: s.total_size_bytes,
            last_modified: s.last_modified,
        })
        .collect();

    if let Some(etag) = etag_header {
        if let Ok(mut cache) = SUMMARY_CACHE.write() {
            cache.insert(
                cache_key,
                EtagCacheEntry {
                    etag,
                    data: out.clone(),
                },
            );
        }
    }

    Ok(out)
}

#[tauri::command]
pub async fn sync_list_remote_saves() -> Result<Vec<RemoteSaveInfoDto>, String> {
    let ctx = get_api_context()?;
    list_remote_saves_for_user(&ctx.base_url, &ctx.api_key, &ctx.user_id, None).await
}

#[tauri::command]
pub async fn sync_list_remote_saves_for_game(
    game_id: String,
) -> Result<Vec<RemoteSaveInfoDto>, String> {
    let ctx = get_api_context()?;
    list_remote_saves_for_user_and_game(&ctx.base_url, &ctx.api_key, &ctx.user_id, &game_id).await
}

#[tauri::command]
pub async fn sync_list_remote_saves_summary() -> Result<Vec<CloudSavesSummaryDto>, String> {
    let ctx = get_api_context()?;
    list_remote_saves_summary_for_user(&ctx.base_url, &ctx.api_key, &ctx.user_id).await
}

#[tauri::command]
pub async fn sync_list_remote_saves_for_user(
    user_id: String,
) -> Result<Vec<RemoteSaveInfoDto>, String> {
    let ctx = get_api_context()?;
    let trimmed_user_id = user_id.trim();
    if trimmed_user_id.is_empty() {
        return Err("userId vacío".into());
    }

    let target = if trimmed_user_id == ctx.user_id {
        None
    } else {
        Some(trimmed_user_id)
    };
    list_remote_saves_for_user(&ctx.base_url, &ctx.api_key, &ctx.user_id, target).await
}

#[tauri::command]
pub async fn sync_delete_game_from_cloud(
    game_id: String,
    permanent: Option<bool>,
) -> Result<(), String> {
    let ctx = get_api_context()?;
    let is_perm = permanent.unwrap_or(false);
    let body = serde_json::json!({
        "gameId": game_id.trim(),
        "permanent": is_perm
    })
    .to_string();

    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/delete-game",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("delete-game: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        return Err(api_error::response_message(res).await);
    }
    invalidate_remote_saves_cache(&ctx.user_id, Some(game_id.trim()));
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashFileItem {
    pub filename: String,
    pub size: u64,
    pub last_modified: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TrashGameItem {
    pub game_id: String,
    pub total_files: usize,
    pub total_size_bytes: u64,
    pub deleted_at: String,
    pub expires_at: String,
    pub files: Vec<TrashFileItem>,
}

#[derive(serde::Deserialize)]
struct TrashListResponse {
    items: Vec<TrashGameItem>,
}

#[tauri::command]
pub async fn sync_list_trash() -> Result<Vec<TrashGameItem>, String> {
    let ctx = get_api_context()?;
    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "GET",
        "/trash",
        None,
    )
    .await
    .map_err(|e| format!("list-trash: {}", e))?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }

    let parsed: TrashListResponse = res
        .json()
        .await
        .map_err(|e| format!("list-trash parse: {}", e))?;

    Ok(parsed.items)
}

#[tauri::command]
pub async fn sync_restore_from_trash(game_id: String) -> Result<(), String> {
    let ctx = get_api_context()?;
    let body = serde_json::json!({ "gameId": game_id.trim() }).to_string();

    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/trash/restore",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("restore-from-trash: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_delete_from_trash(game_id: String) -> Result<(), String> {
    let ctx = get_api_context()?;
    let body = serde_json::json!({ "gameId": game_id.trim() }).to_string();

    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/trash/delete",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("delete-from-trash: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_empty_trash() -> Result<(), String> {
    let ctx = get_api_context()?;

    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/trash/empty",
        None,
    )
    .await
    .map_err(|e| format!("empty-trash: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_rename_game_in_cloud(
    old_game_id: String,
    new_game_id: String,
) -> Result<(), String> {
    let ctx = get_api_context()?;
    let body = serde_json::json!({
        "oldGameId": old_game_id.trim(),
        "newGameId": new_game_id.trim()
    })
    .to_string();

    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/rename-game",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("rename-game: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

const FRIEND_COPY_FILE_CONCURRENCY: usize = 4;

fn should_emit_friend_copy_progress(
    throttle: &Mutex<TransferProgressThrottle>,
    loaded: u64,
    is_final: bool,
) -> bool {
    throttle
        .lock()
        .map(|mut state| state.should_emit(loaded, is_final))
        .unwrap_or(is_final)
}

fn emit_friend_copy_progress(
    app: &AppHandle,
    operation_id: &str,
    game_id: &str,
    filename: &str,
    loaded: u64,
    total: u64,
    metrics: &Mutex<TransferSpeedTracker>,
    is_final: bool,
) {
    emit_sync_download_progress(
        app,
        SyncProgressPayload {
            operation_id: Some(operation_id.to_string()),
            status: Some("running".to_string()),
            game_id: game_id.to_string(),
            filename: filename.to_string(),
            loaded,
            total,
            downloaded_bytes: Some(loaded),
            total_bytes: Some(total),
            can_pause: Some(false),
            can_cancel: Some(false),
            can_resume: Some(false),
            strategy: Some(SyncOperationStrategy::DownloadFile),
            state: None,
            reason_code: None,
        },
    );

    let sample = metrics.lock().ok().map(|mut tracker| {
        let now = Instant::now();
        if is_final {
            tracker.record_final(loaded, total, now)
        } else {
            tracker.record(loaded, total, now)
        }
    });
    if let Some(TransferSample {
        download_speed_bytes,
        eta_seconds,
    }) = sample
    {
        let _ = app.emit(
            "sync-transfer-metrics",
            serde_json::json!({
                "operationId": operation_id,
                "speedBytesPerSecond": download_speed_bytes,
                "etaSeconds": eta_seconds,
            }),
        );
    }
}

async fn copy_friend_saves_with_plan_impl(
    _friend_user_id: &str,
    game_id: &str,
    plan: Vec<CopyFriendFilePlanDto>,
    operation_id: String,
    app: AppHandle,
) -> Result<SyncResultDto, String> {
    let total = plan
        .iter()
        .try_fold(0_u64, |total, item| {
            item.size
                .map(|size| total.saturating_add(size.saturating_mul(2)))
        })
        .unwrap_or(0);
    let loaded = Arc::new(AtomicU64::new(0));
    let metrics = Arc::new(Mutex::new(TransferSpeedTracker::new()));
    let progress_throttle = Arc::new(Mutex::new(TransferProgressThrottle::new(
        PACKAGED_PROGRESS_POLICY,
    )));

    let result = copy_friend_saves_with_plan_transfer(
        game_id,
        plan,
        app.clone(),
        operation_id.clone(),
        loaded,
        metrics,
        progress_throttle,
        total,
    )
    .await;

    let status = match &result {
        Ok(result) if result.err_count == 0 => "completed",
        _ => "failed",
    };
    emit_sync_terminal(
        &app,
        operation_id,
        status,
        "download",
        Some(game_id.to_string()),
        None,
        None,
    );

    result
}

async fn copy_friend_saves_with_plan_transfer(
    game_id: &str,
    plan: Vec<CopyFriendFilePlanDto>,
    app: AppHandle,
    operation_id: String,
    loaded: Arc<AtomicU64>,
    metrics: Arc<Mutex<TransferSpeedTracker>>,
    progress_throttle: Arc<Mutex<TransferProgressThrottle>>,
    total: u64,
) -> Result<SyncResultDto, String> {
    let ctx = get_api_context()?;

    if plan.is_empty() {
        return Ok(SyncResultDto {
            ok_count: 0,
            err_count: 0,
            errors: vec!["El amigo no tiene guardados".into()],
        });
    }

    let download_requests: Vec<(String, String)> = plan
        .iter()
        .map(|p| (game_id.to_string(), p.key.clone()))
        .collect();

    let download_urls = match get_download_urls(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        &download_requests,
    )
    .await
    {
        Ok(urls) => urls,
        Err(e) => {
            return Err(format!(
                "Fallo al obtener URLs de descarga en bloque: {}",
                e
            ))
        }
    };

    let upload_requests: Vec<String> = plan.iter().map(|p| p.target_filename.clone()).collect();
    let upload_urls = match get_upload_urls(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        game_id,
        &upload_requests,
    )
    .await
    {
        Ok(urls) => urls,
        Err(e) => return Err(format!("Fallo al obtener URLs de subida en bloque: {}", e)),
    };

    let download_map: std::collections::HashMap<_, _> = download_urls
        .into_iter()
        .map(|(url, key)| (key, url))
        .collect();
    let upload_map: std::collections::HashMap<_, _> = upload_urls
        .into_iter()
        .map(|(url, filename)| (filename, url))
        .collect();

    let mut set = tokio::task::JoinSet::new();
    let file_semaphore = Arc::new(tokio::sync::Semaphore::new(FRIEND_COPY_FILE_CONCURRENCY));

    for item in plan {
        let download_url = download_map.get(&item.key).cloned();
        let upload_url = upload_map.get(&item.target_filename).cloned();

        let app = app.clone();
        let operation_id = operation_id.clone();
        let game_id = game_id.to_string();
        let loaded = Arc::clone(&loaded);
        let metrics = Arc::clone(&metrics);
        let progress_throttle = Arc::clone(&progress_throttle);
        let file_semaphore = Arc::clone(&file_semaphore);
        set.spawn(async move {
            let mut item_err = None;
            let mut success = false;

            let d_url = match download_url {
                Some(u) => u,
                None => return (item, false, Some("Sin URL de descarga".to_string())),
            };
            let u_url = match upload_url {
                Some(u) => u,
                None => return (item, false, Some("Sin URL de subida".to_string())),
            };

            let _permit = match file_semaphore.acquire_owned().await {
                Ok(permit) => permit,
                Err(error) => {
                    return (
                        item,
                        false,
                        Some(format!("No se pudo iniciar la transferencia: {}", error)),
                    )
                }
            };

            let response = match API_CLIENT.get(&d_url).send().await {
                Ok(resp) if resp.status().is_success() => resp,
                Ok(resp) => {
                    return (
                        item,
                        false,
                        Some(format!("error HTTP descarga: {}", resp.status())),
                    )
                }
                Err(e) => {
                    return (
                        item,
                        false,
                        Some(format!("falla de red en descarga: {}", e)),
                    )
                }
            };

            let content_length = response.content_length().or(item.size);
            let download_stream = response.bytes_stream().map({
                let app = app.clone();
                let operation_id = operation_id.clone();
                let game_id = game_id.clone();
                let filename = item.filename.clone();
                let loaded = Arc::clone(&loaded);
                let metrics = Arc::clone(&metrics);
                let progress_throttle = Arc::clone(&progress_throttle);

                move |chunk| {
                    if let Ok(bytes) = &chunk {
                        let current = loaded.fetch_add(bytes.len() as u64, Ordering::Relaxed)
                            + bytes.len() as u64;
                        if should_emit_friend_copy_progress(&progress_throttle, current, false) {
                            emit_friend_copy_progress(
                                &app,
                                &operation_id,
                                &game_id,
                                &filename,
                                current,
                                total,
                                &metrics,
                                false,
                            );
                        }
                    }
                    chunk
                }
            });
            let upload_stream = download_stream.map({
                let app = app.clone();
                let operation_id = operation_id.clone();
                let game_id = game_id.clone();
                let filename = item.target_filename.clone();
                let loaded = Arc::clone(&loaded);
                let metrics = Arc::clone(&metrics);
                let progress_throttle = Arc::clone(&progress_throttle);

                move |chunk| {
                    if let Ok(bytes) = &chunk {
                        let current = loaded.fetch_add(bytes.len() as u64, Ordering::Relaxed)
                            + bytes.len() as u64;
                        if should_emit_friend_copy_progress(&progress_throttle, current, false) {
                            emit_friend_copy_progress(
                                &app,
                                &operation_id,
                                &game_id,
                                &filename,
                                current,
                                total,
                                &metrics,
                                false,
                            );
                        }
                    }
                    chunk
                }
            });

            let mut request = API_CLIENT
                .put(&u_url)
                .body(reqwest::Body::wrap_stream(upload_stream))
                .header("Content-Type", "application/octet-stream");
            if let Some(content_length) = content_length {
                request = request.header("Content-Length", content_length.to_string());
            }

            match request.send().await {
                Ok(put_res) if put_res.status().is_success() => success = true,
                Ok(put_res) => item_err = Some(format!("error S3 PUT: {}", put_res.status())),
                Err(e) => item_err = Some(format!("falla de red en subida: {}", e)),
            };

            (item, success, item_err)
        });
    }

    let mut ok_count = 0;
    let mut err_count = 0;
    let mut errors = Vec::new();
    let mut last_completed_filename = String::new();

    while let Some(res) = set.join_next().await {
        match res {
            Ok((item, success, err_opt)) => {
                last_completed_filename.clone_from(&item.target_filename);
                if success {
                    ok_count += 1;
                } else {
                    err_count += 1;
                    if let Some(e) = err_opt {
                        errors.push(format!("{}: {}", item.filename, e));
                    }
                }
            }
            Err(e) => {
                err_count += 1;
                errors.push(format!("Fallo crítico en hilo de transferencia: {}", e));
            }
        }
    }

    let final_loaded = loaded.load(Ordering::Relaxed);
    if should_emit_friend_copy_progress(&progress_throttle, final_loaded, true) {
        emit_friend_copy_progress(
            &app,
            &operation_id,
            game_id,
            &last_completed_filename,
            final_loaded,
            total,
            &metrics,
            true,
        );
    }

    let result = SyncResultDto {
        ok_count,
        err_count,
        errors,
    };

    let _ = crate::config::append_operation_log(
        "copy_friend",
        game_id,
        result.ok_count,
        result.err_count,
    );

    Ok(result)
}

#[tauri::command]
pub async fn copy_friend_saves(
    friend_user_id: String,
    game_id: String,
    operation_id: String,
    app: AppHandle,
) -> Result<SyncResultDto, String> {
    let friend_id = friend_user_id.trim();
    if friend_id.is_empty() {
        return Err("friendUserId vacío".into());
    }

    let game_id_trimmed = game_id.trim();
    if game_id_trimmed.is_empty() {
        return Err("gameId vacío".into());
    }

    let ctx = get_api_context()?;
    let target = if friend_id == ctx.user_id {
        None
    } else {
        Some(friend_id)
    };
    let all_saves =
        list_remote_saves_for_user(&ctx.base_url, &ctx.api_key, &ctx.user_id, target).await?;

    let plan: Vec<CopyFriendFilePlanDto> = all_saves
        .into_iter()
        .filter(|s| s.game_id.eq_ignore_ascii_case(game_id_trimmed))
        .map(|s| CopyFriendFilePlanDto {
            key: s.key,
            filename: s.filename.clone(),
            target_filename: s.filename,
            size: s.size,
        })
        .collect();

    copy_friend_saves_with_plan_impl(friend_id, game_id_trimmed, plan, operation_id, app).await
}

#[tauri::command]
pub async fn copy_friend_saves_with_plan(
    friend_user_id: String,
    game_id: String,
    plan: Vec<CopyFriendFilePlanDto>,
    operation_id: String,
    app: AppHandle,
) -> Result<SyncResultDto, String> {
    let friend_id = friend_user_id.trim();
    let game_id_trimmed = game_id.trim();

    if friend_id.is_empty() || game_id_trimmed.is_empty() {
        return Err("friendUserId o gameId están vacíos".into());
    }

    copy_friend_saves_with_plan_impl(friend_id, game_id_trimmed, plan, operation_id, app).await
}

#[tauri::command]
pub async fn get_s3_transfer_endpoint_type() -> Result<String, String> {
    if let Ok(lock) = S3_ENDPOINT_CACHE.read() {
        if let Some(cached) = &*lock {
            return Ok(cached.clone());
        }
    }

    let Ok(ctx) = get_api_context() else {
        return Ok("unknown".to_string());
    };

    let body = serde_json::json!({
        "gameId": "__check__",
        "filename": "__check__.tmp"
    })
    .to_string();

    let res = match api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/upload-url",
        Some(body.as_bytes()),
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return Ok("unknown".to_string()),
    };

    if !res.status().is_success() {
        return Ok("unknown".to_string());
    }

    let json: serde_json::Value = res.json().await.unwrap_or_default();
    let upload_url = json.get("uploadUrl").and_then(|v| v.as_str()).unwrap_or("");

    let endpoint_type = if upload_url.contains(S3_ACCELERATE_HOST) {
        "accelerated".to_string()
    } else {
        "standard".to_string()
    };

    if let Ok(mut lock) = S3_ENDPOINT_CACHE.write() {
        *lock = Some(endpoint_type.clone());
    }

    Ok(endpoint_type)
}
