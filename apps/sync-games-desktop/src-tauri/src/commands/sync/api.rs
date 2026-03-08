//! Cliente HTTP para la API de guardados.

use super::models::SyncResultDto;
use super::models::{RemoteSaveDto, RemoteSaveInfoDto};
use serde::{Deserialize, Serialize};

const S3_ACCELERATE_HOST: &str = "s3-accelerate.amazonaws.com";

/// Escribe en stderr si la URL usa el endpoint acelerado (para verlo al ejecutar con `cargo tauri dev`).
pub(crate) fn log_transfer_endpoint(kind: &str, url: &str) {
    let accelerated = url.contains(S3_ACCELERATE_HOST);
    eprintln!(
        "[savecloud] {}: endpoint {}",
        kind,
        if accelerated {
            "acelerado (s3-accelerate.amazonaws.com)"
        } else {
            "estándar"
        }
    );
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
    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut req = client
        .request(method.parse().unwrap(), &url)
        .header("x-user-id", user_id)
        .header("x-api-key", api_key);

    if let Some(b) = body {
        req = req
            .header("Content-Type", "application/json")
            .body(b.to_vec());
    }

    let res = req.send().await.map_err(|e| e.to_string())?;
    Ok(res)
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
    _key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadUrlsResponse {
    urls: Vec<DownloadUrlResultItem>,
}

/// Obtiene varias URLs de subida en una sola petición (batch).
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
    let body = serde_json::json!({ "items": items });
    let body_bytes = body.to_string().into_bytes();
    let res = api_request(
        base_url,
        user_id,
        api_key,
        "POST",
        "/upload-urls",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("upload-urls: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API upload-urls: {} {}", status, text));
    }
    let parsed: UploadUrlsResponse = res.json().await.map_err(|e| e.to_string())?;
    if let Some(first) = parsed.urls.first() {
        log_transfer_endpoint("Subida", &first.upload_url);
    }
    Ok(parsed
        .urls
        .into_iter()
        .map(|u| (u.upload_url, u.filename))
        .collect())
}

/// Obtiene varias URLs de descarga en una sola petición (batch).
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
    let body = serde_json::json!({ "items": req_items });
    let body_bytes = body.to_string().into_bytes();
    let res = api_request(
        base_url,
        user_id,
        api_key,
        "POST",
        "/download-urls",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("download-urls: {}", e))?;
    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API download-urls: {} {}", status, text));
    }
    let parsed: DownloadUrlsResponse = res.json().await.map_err(|e| e.to_string())?;
    if let Some(first) = parsed.urls.first() {
        log_transfer_endpoint("Descarga", &first.download_url);
    }
    Ok(parsed
        .urls
        .into_iter()
        .map(|u| (u.download_url, u._key))
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
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API: {} {}", status, text));
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

/// Lista todos los guardados remotos del usuario actual.
#[tauri::command]
pub async fn sync_list_remote_saves() -> Result<Vec<RemoteSaveInfoDto>, String> {
    let cfg = crate::config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    list_remote_saves_for_user(api_base, api_key, user_id).await
}

/// Lista todos los guardados remotos de otro usuario (amigo).
#[tauri::command]
pub async fn sync_list_remote_saves_for_user(
    user_id: String,
) -> Result<Vec<RemoteSaveInfoDto>, String> {
    let cfg = crate::config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");
    let user_id = user_id.trim();
    if user_id.is_empty() {
        return Err("userId vacío".into());
    }
    list_remote_saves_for_user(api_base, api_key, user_id).await
}

/// Borra todos los guardados del juego en la nube (S3).
#[tauri::command]
pub async fn sync_delete_game_from_cloud(game_id: String) -> Result<(), String> {
    let cfg = crate::config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");
    let body = serde_json::json!({ "gameId": game_id.trim() });
    let body_bytes = body.to_string().into_bytes();
    let res = api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/delete-game",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("delete-game: {}", e))?;
    if !res.status().is_success() && res.status().as_u16() != 204 {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API delete-game: {} {}", status, text));
    }
    Ok(())
}

/// Renombra un juego en la nube (copia objetos de old_game_id a new_game_id y borra los antiguos).
#[tauri::command]
pub async fn sync_rename_game_in_cloud(
    old_game_id: String,
    new_game_id: String,
) -> Result<(), String> {
    let cfg = crate::config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");
    let body = serde_json::json!({
        "oldGameId": old_game_id.trim(),
        "newGameId": new_game_id.trim()
    });
    let body_bytes = body.to_string().into_bytes();
    let res = api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/rename-game",
        Some(&body_bytes),
    )
    .await
    .map_err(|e| format!("rename-game: {}", e))?;
    if !res.status().is_success() && res.status().as_u16() != 204 {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("API rename-game: {} {}", status, text));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyFriendFilePlanDto {
    pub key: String,
    pub filename: String,
    pub target_filename: String,
}

/// Implementación común para copiar guardados de un amigo según un plan.
async fn copy_friend_saves_with_plan_impl(
    friend_user_id: &str,
    game_id: &str,
    plan: Vec<CopyFriendFilePlanDto>,
) -> Result<SyncResultDto, String> {
    let cfg = crate::config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let current_user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    let client = reqwest::Client::builder()
        .user_agent("sync-games-desktop/1.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut ok_count = 0u32;
    let mut err_count = 0u32;
    let mut errors = Vec::new();

    if plan.is_empty() {
        return Ok(SyncResultDto {
            ok_count,
            err_count,
            errors: vec!["No hay archivos en el plan de copia".into()],
        });
    }

    for item in plan {
        // 2. Pedir URL de descarga usando el userId del amigo
        let body_download = serde_json::json!({
            "gameId": game_id,
            "key": item.key
        });
        let res_download = api_request(
            api_base,
            friend_user_id,
            api_key,
            "POST",
            "/download-url",
            Some(body_download.to_string().as_bytes()),
        )
        .await
        .map_err(|e| format!("download-url: {}", e))?;

        if !res_download.status().is_success() {
            errors.push(format!(
                "{}: API download-url {}",
                item.filename,
                res_download.status()
            ));
            err_count += 1;
            continue;
        }

        let json_download: serde_json::Value =
            res_download.json().await.map_err(|e| e.to_string())?;
        let download_url = match json_download.get("downloadUrl").and_then(|v| v.as_str()) {
            Some(u) => u,
            None => {
                errors.push(format!("{}: API no devolvió downloadUrl", item.filename));
                err_count += 1;
                continue;
            }
        };

        // 3. Pedir URL de subida en TU cuenta
        let body_upload = serde_json::json!({
            "gameId": game_id,
            "filename": item.target_filename
        });
        let res_upload = api_request(
            api_base,
            current_user_id,
            api_key,
            "POST",
            "/upload-url",
            Some(body_upload.to_string().as_bytes()),
        )
        .await
        .map_err(|e| format!("upload-url: {}", e))?;

        if !res_upload.status().is_success() {
            errors.push(format!(
                "{}: API upload-url {}",
                item.target_filename,
                res_upload.status()
            ));
            err_count += 1;
            continue;
        }

        let json_upload: serde_json::Value = res_upload.json().await.map_err(|e| e.to_string())?;
        let upload_url = match json_upload.get("uploadUrl").and_then(|v| v.as_str()) {
            Some(u) => u,
            None => {
                errors.push(format!(
                    "{}: API no devolvió uploadUrl",
                    item.target_filename
                ));
                err_count += 1;
                continue;
            }
        };

        // 4. Descargar del amigo y subir a tu cuenta
        let bytes = match client.get(download_url).send().await {
            Ok(resp) => match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    errors.push(format!("{}: error leyendo descarga: {}", item.filename, e));
                    err_count += 1;
                    continue;
                }
            },
            Err(e) => {
                errors.push(format!("{}: error HTTP descarga: {}", item.filename, e));
                err_count += 1;
                continue;
            }
        };

        let content_length = bytes.len();
        let put_res = match client
            .put(upload_url)
            .body(bytes)
            .header("Content-Type", "application/octet-stream")
            .header("Content-Length", content_length.to_string())
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                errors.push(format!(
                    "{}: error HTTP subida: {}",
                    item.target_filename, e
                ));
                err_count += 1;
                continue;
            }
        };

        if !put_res.status().is_success() {
            errors.push(format!(
                "{}: S3 PUT {}",
                item.target_filename,
                put_res.status()
            ));
            err_count += 1;
        } else {
            ok_count += 1;
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

/// Copia todos los guardados de un juego desde la cuenta de un amigo a la cuenta actual.
#[tauri::command]
pub async fn copy_friend_saves(
    friend_user_id: String,
    game_id: String,
) -> Result<SyncResultDto, String> {
    let cfg = crate::config::load_config();
    let api_base = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?;
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    let friend_id = friend_user_id.trim();
    if friend_id.is_empty() {
        return Err("friendUserId vacío".into());
    }
    let game_id_trimmed = game_id.trim().to_string();
    if game_id_trimmed.is_empty() {
        return Err("gameId vacío".into());
    }

    // 1. Listar todos los saves del amigo para este juego y construir plan por defecto (mismo nombre).
    let all_saves = list_remote_saves_for_user(api_base, api_key, friend_id).await?;
    let plan: Vec<CopyFriendFilePlanDto> = all_saves
        .into_iter()
        .filter(|s| s.game_id.eq_ignore_ascii_case(&game_id_trimmed))
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
            errors: vec!["El amigo no tiene guardados para este juego".into()],
        });
    }

    copy_friend_saves_with_plan_impl(friend_id, &game_id_trimmed, plan).await
}

/// Copia guardados de un amigo usando un plan detallado (para manejo avanzado de conflictos).
#[tauri::command]
pub async fn copy_friend_saves_with_plan(
    friend_user_id: String,
    game_id: String,
    plan: Vec<CopyFriendFilePlanDto>,
) -> Result<SyncResultDto, String> {
    let friend_id = friend_user_id.trim().to_string();
    if friend_id.is_empty() {
        return Err("friendUserId vacío".into());
    }
    let game_id_trimmed = game_id.trim().to_string();
    if game_id_trimmed.is_empty() {
        return Err("gameId vacío".into());
    }

    copy_friend_saves_with_plan_impl(&friend_id, &game_id_trimmed, plan).await
}

/// Devuelve si la API está dando URLs con S3 Transfer Acceleration ("accelerated" | "standard" | "unknown").
/// Sirve para mostrarlo en Configuración.
#[tauri::command]
pub async fn get_s3_transfer_endpoint_type() -> Result<String, String> {
    let cfg = crate::config::load_config();
    let api_base = match cfg.api_base_url.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(b) => b,
        None => return Ok("unknown".to_string()),
    };
    let user_id = match cfg.user_id.as_deref().filter(|s| !s.trim().is_empty()) {
        Some(u) => u,
        None => return Ok("unknown".to_string()),
    };
    let api_key = cfg.api_key.as_deref().unwrap_or("");

    let body = serde_json::json!({
        "gameId": "__check__",
        "filename": "__check__.tmp"
    });
    let body_bytes = body.to_string().into_bytes();
    let res = match api_request(
        api_base,
        user_id,
        api_key,
        "POST",
        "/upload-url",
        Some(&body_bytes),
    )
    .await
    {
        Ok(r) => r,
        Err(_) => return Ok("unknown".to_string()),
    };

    if !res.status().is_success() {
        return Ok("unknown".to_string());
    }
    let json: serde_json::Value = match res.json().await {
        Ok(j) => j,
        Err(_) => return Ok("unknown".to_string()),
    };
    let upload_url = json.get("uploadUrl").and_then(|v| v.as_str()).unwrap_or("");
    Ok(if upload_url.contains(S3_ACCELERATE_HOST) {
        "accelerated".to_string()
    } else {
        "standard".to_string()
    })
}
