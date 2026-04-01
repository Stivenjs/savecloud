//! Cliente HTTP para la API de gestión de guardados.
//!
//! Encapsula la comunicación con el backend, proporcionando métodos
//! para interactuar con los endpoints relacionados con la sincronización
//! de archivos.
//!
//! Incluye configuración de timeouts, manejo de errores y soporte para
//! reintentos en solicitudes críticas.

use super::context::ApiContext;
use super::models::SyncResultDto;
use super::models::{CloudSavesSummaryDto, RemoteSaveDto, RemoteSaveInfoDto};
use crate::network::API_CLIENT;
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

const S3_ACCELERATE_HOST: &str = "s3-accelerate.amazonaws.com";

static S3_ENDPOINT_CACHE: LazyLock<std::sync::RwLock<Option<String>>> =
    LazyLock::new(|| std::sync::RwLock::new(None));

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
}

fn get_api_context() -> Result<ApiContext, String> {
    super::context::resolve_api_context()
}

pub(crate) async fn api_request(
    base_url: &str,
    user_id: &str,
    api_key: &str,
    method: &str,
    path: &str,
    body: Option<&[u8]>,
) -> Result<reqwest::Response, String> {
    let url = format!("{}/saves{}", base_url.trim_end_matches('/'), path);

    let mut req = API_CLIENT
        .request(method.parse().unwrap(), &url)
        .header("x-user-id", user_id)
        .header("x-api-key", api_key);

    let active_host = crate::config::load_settings()
        .active_cloud_host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    if let Some(host) = active_host {
        req = req.header("x-cloud-host-user-id", host);
    }

    if let Some(b) = body {
        req = req
            .header("Content-Type", "application/json")
            .body(b.to_vec());
    }

    req.send().await.map_err(|e| e.to_string())
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
        return Err(format!(
            "API upload-urls: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
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
        return Err(format!(
            "API download-urls: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
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
    let res = api_request(api_base, authenticated_user_id, api_key, "GET", &path, None)
        .await
        .map_err(|e| format!("GET /saves: {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "API: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

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
    let path = format!("?gameId={}", urlencoding::encode(trimmed_game_id));
    let res = api_request(api_base, user_id, api_key, "GET", &path, None)
        .await
        .map_err(|e| format!("GET /saves?gameId: {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "API: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

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
    let res = api_request(api_base, user_id, api_key, "GET", "/summary", None)
        .await
        .map_err(|e| format!("GET /saves/summary: {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "API: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

    let raw: Vec<CloudSavesSummaryItem> = res.json().await.map_err(|e| e.to_string())?;
    Ok(raw
        .into_iter()
        .map(|s| CloudSavesSummaryDto {
            game_id: s.game_id,
            file_count: s.file_count,
            total_size_bytes: s.total_size_bytes,
            last_modified: s.last_modified,
        })
        .collect())
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
pub async fn sync_delete_game_from_cloud(game_id: String) -> Result<(), String> {
    let ctx = get_api_context()?;
    let body = serde_json::json!({ "gameId": game_id.trim() }).to_string();

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
        return Err(format!(
            "API delete-game: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
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
        return Err(format!(
            "API rename-game: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }
    Ok(())
}

async fn copy_friend_saves_with_plan_impl(
    _friend_user_id: &str,
    game_id: &str,
    plan: Vec<CopyFriendFilePlanDto>,
) -> Result<SyncResultDto, String> {
    let ctx = get_api_context()?;

    if plan.is_empty() {
        return Ok(SyncResultDto {
            ok_count: 0,
            err_count: 0,
            errors: vec!["No hay archivos en el plan".into()],
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

    for item in plan {
        let download_url = download_map.get(&item.key).cloned();
        let upload_url = upload_map.get(&item.target_filename).cloned();

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

            let bytes = match API_CLIENT.get(&d_url).send().await {
                Ok(resp) if resp.status().is_success() => match resp.bytes().await {
                    Ok(b) => b,
                    Err(e) => return (item, false, Some(format!("error leyendo descarga: {}", e))),
                },
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

            let content_length = bytes.len();
            match API_CLIENT
                .put(&u_url)
                .body(bytes)
                .header("Content-Type", "application/octet-stream")
                .header("Content-Length", content_length.to_string())
                .send()
                .await
            {
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

    while let Some(res) = set.join_next().await {
        match res {
            Ok((item, success, err_opt)) => {
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
        })
        .collect();

    if plan.is_empty() {
        return Ok(SyncResultDto {
            ok_count: 0,
            err_count: 0,
            errors: vec!["El amigo no tiene guardados".into()],
        });
    }

    copy_friend_saves_with_plan_impl(friend_id, game_id_trimmed, plan).await
}

#[tauri::command]
pub async fn copy_friend_saves_with_plan(
    friend_user_id: String,
    game_id: String,
    plan: Vec<CopyFriendFilePlanDto>,
) -> Result<SyncResultDto, String> {
    let friend_id = friend_user_id.trim();
    let game_id_trimmed = game_id.trim();

    if friend_id.is_empty() || game_id_trimmed.is_empty() {
        return Err("friendUserId o gameId están vacíos".into());
    }

    copy_friend_saves_with_plan_impl(friend_id, game_id_trimmed, plan).await
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
