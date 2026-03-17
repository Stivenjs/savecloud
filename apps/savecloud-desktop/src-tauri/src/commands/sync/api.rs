//! Cliente HTTP para la API de guardados.

use super::models::SyncResultDto;
use super::models::{RemoteSaveDto, RemoteSaveInfoDto};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

const S3_ACCELERATE_HOST: &str = "s3-accelerate.amazonaws.com";

static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("SaveCloud-desktop/1.0")
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("Fallo al construir el cliente HTTP estático")
});

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

struct ApiContext {
    base_url: String,
    user_id: String,
    api_key: String,
}

fn get_api_context() -> Result<ApiContext, String> {
    let cfg = crate::config::load_config();
    let base_url = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?
        .to_string();
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?
        .to_string();
    let api_key = cfg.api_key.unwrap_or_default();

    Ok(ApiContext {
        base_url,
        user_id,
        api_key,
    })
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

    let mut req = HTTP_CLIENT
        .request(method.parse().unwrap(), &url)
        .header("x-user-id", user_id)
        .header("x-api-key", api_key);

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

async fn list_remote_saves_for_user(
    api_base: &str,
    api_key: &str,
    user_id: &str,
) -> Result<Vec<RemoteSaveInfoDto>, String> {
    let res = api_request(api_base, user_id, api_key, "GET", "", None)
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

#[tauri::command]
pub async fn sync_list_remote_saves() -> Result<Vec<RemoteSaveInfoDto>, String> {
    let ctx = get_api_context()?;
    list_remote_saves_for_user(&ctx.base_url, &ctx.api_key, &ctx.user_id).await
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

    list_remote_saves_for_user(&ctx.base_url, &ctx.api_key, trimmed_user_id).await
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
    friend_user_id: &str,
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

    // A. Pedir TODAS las URLs de descarga del amigo de una vez
    let download_requests: Vec<(String, String)> = plan
        .iter()
        .map(|p| (game_id.to_string(), p.key.clone()))
        .collect();

    let download_urls = match get_download_urls(
        &ctx.base_url,
        friend_user_id,
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

    // B. Pedir TODAS las URLs de subida propias de una vez
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

    // Mapeos rápidos para buscar las URLs por clave/filename
    let download_map: std::collections::HashMap<_, _> = download_urls
        .into_iter()
        .map(|(url, key)| (key, url))
        .collect();
    let upload_map: std::collections::HashMap<_, _> = upload_urls
        .into_iter()
        .map(|(url, filename)| (filename, url))
        .collect();

    // C. Lanzar todas las transferencias en paralelo
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

            // Descargar de S3 a memoria
            let bytes = match HTTP_CLIENT.get(&d_url).send().await {
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

            // Subir desde memoria al S3 destino
            let content_length = bytes.len();
            match HTTP_CLIENT
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

    // D. Recolectar resultados a medida que los hilos terminan
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
    let all_saves = list_remote_saves_for_user(&ctx.base_url, &ctx.api_key, friend_id).await?;

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

    Ok(if upload_url.contains(S3_ACCELERATE_HOST) {
        "accelerated".to_string()
    } else {
        "standard".to_string()
    })
}
