//! Seed cloud de Steam: exportar manifest a S3 vía API, resetear estado e importar batches a SQLite.

use super::api::api_request;
use super::context::resolve_api_context;
use crate::network::API_CLIENT;
use crate::sqlite::error::SqliteError;
use crate::sqlite::AppDb;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedUploadUrlResponse {
    upload_url: String,
    #[serde(rename = "key")]
    _key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedBatchesResponse {
    keys: Vec<String>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedBatchDownloadUrlResponse {
    download_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedBatchLine {
    app_id: u32,
    #[serde(default)]
    steam_success: Option<bool>,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedExportResultDto {
    pub app_ids_exported: u32,
    pub parts_uploaded: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedImportResultDto {
    pub batches_processed: u32,
    pub rows_updated: u32,
}

fn list_all_catalog_app_ids(conn: &Connection) -> Result<Vec<u32>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT app_id FROM steam_catalog_apps ORDER BY app_id ASC")?;
    let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
    let mut out = Vec::new();
    for r in rows {
        let id_i64 = r?;
        if id_i64 > 0 {
            out.push(id_i64 as u32);
        }
    }
    Ok(out)
}

fn apply_seed_updates(
    conn: &Connection,
    updates: &[(u32, String)],
) -> Result<u32, rusqlite::Error> {
    if updates.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    let mut updated: u32 = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO steam_catalog_apps (
                app_id,
                name,
                name_normalized,
                details_json,
                enriched_at,
                last_sync_batch_at
             )
             VALUES (?1, ?2, ?3, ?4, unixepoch(), unixepoch())
             ON CONFLICT(app_id) DO UPDATE SET
                details_json = excluded.details_json,
                enriched_at = unixepoch(),
                name = CASE
                    WHEN steam_catalog_apps.name IS NULL OR steam_catalog_apps.name = '' THEN excluded.name
                    ELSE steam_catalog_apps.name
                END,
                name_normalized = CASE
                    WHEN steam_catalog_apps.name_normalized IS NULL OR steam_catalog_apps.name_normalized = '' THEN excluded.name_normalized
                    ELSE steam_catalog_apps.name_normalized
                END",
        )?;
        for (app_id, json) in updates {
            let inferred_name =
                infer_name_from_details_json(json).unwrap_or_else(|| format!("App {}", app_id));
            let inferred_name_norm = normalize_display_name_for_seed(&inferred_name);
            let n = stmt.execute(rusqlite::params![
                app_id,
                inferred_name,
                inferred_name_norm,
                json
            ])?;
            updated = updated.saturating_add(n as u32);
        }
    }
    tx.commit()?;
    Ok(updated)
}

fn infer_name_from_details_json(details_json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(details_json).ok()?;
    let name = v.get("name")?.as_str()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

fn normalize_display_name_for_seed(name: &str) -> String {
    name.trim().to_lowercase()
}

#[tauri::command]
pub async fn sync_export_steam_manifest_to_cloud_seed(
    db: State<'_, AppDb>,
    part_size: Option<u32>,
) -> Result<SteamSeedExportResultDto, String> {
    let ctx = resolve_api_context()?;
    let db = db.inner().clone();
    let app_ids = tokio::task::spawn_blocking(move || db.with_conn(list_all_catalog_app_ids))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e: SqliteError| e.to_string())?;

    if app_ids.is_empty() {
        return Ok(SteamSeedExportResultDto {
            app_ids_exported: 0,
            parts_uploaded: 0,
        });
    }

    let size = part_size.unwrap_or(50_000).clamp(1, 100_000) as usize;
    let mut parts_uploaded: u32 = 0;
    let mut offset = 0usize;
    while offset < app_ids.len() {
        let end = (offset + size).min(app_ids.len());
        let chunk = &app_ids[offset..end];
        let part_index = (offset / size) as u32;

        let body = serde_json::json!({ "partIndex": part_index }).to_string();
        let res = api_request(
            &ctx.base_url,
            &ctx.user_id,
            &ctx.api_key,
            "POST",
            "/steam-seed/manifest/upload-url",
            Some(body.as_bytes()),
        )
        .await
        .map_err(|e| format!("manifest/upload-url: {}", e))?;
        if !res.status().is_success() {
            return Err(format!(
                "API steam-seed manifest upload-url: {} {}",
                res.status(),
                res.text().await.unwrap_or_default()
            ));
        }
        let upload: SteamSeedUploadUrlResponse = res.json().await.map_err(|e| e.to_string())?;
        let payload = chunk
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        let put = API_CLIENT
            .put(&upload.upload_url)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !put.status().is_success() {
            return Err(format!(
                "S3 PUT manifest part {}: {} {}",
                part_index,
                put.status(),
                put.text().await.unwrap_or_default()
            ));
        }
        parts_uploaded += 1;
        offset = end;
    }

    Ok(SteamSeedExportResultDto {
        app_ids_exported: app_ids.len() as u32,
        parts_uploaded,
    })
}

#[tauri::command]
pub async fn sync_reset_cloud_seed_state() -> Result<(), String> {
    let ctx = resolve_api_context()?;
    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/steam-seed/reset",
        None,
    )
    .await
    .map_err(|e| format!("steam-seed/reset: {}", e))?;
    if !res.status().is_success() && res.status().as_u16() != 204 {
        return Err(format!(
            "API steam-seed/reset: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }
    Ok(())
}

#[tauri::command]
pub async fn sync_import_cloud_seed_batches_to_sqlite(
    db: State<'_, AppDb>,
    max_batches: Option<u32>,
) -> Result<SteamSeedImportResultDto, String> {
    let ctx = resolve_api_context()?;
    let max_batches = max_batches.unwrap_or(50).clamp(1, 500);

    let mut cursor: Option<String> = None;
    let mut to_process: Vec<String> = Vec::new();
    while (to_process.len() as u32) < max_batches {
        let path = if let Some(c) = &cursor {
            format!(
                "/steam-seed/batches?maxKeys=200&cursor={}",
                urlencoding::encode(c)
            )
        } else {
            "/steam-seed/batches?maxKeys=200".to_string()
        };
        let list_res = api_request(
            &ctx.base_url,
            &ctx.user_id,
            &ctx.api_key,
            "GET",
            &path,
            None,
        )
        .await
        .map_err(|e| format!("steam-seed/batches: {}", e))?;
        if !list_res.status().is_success() {
            return Err(format!(
                "API steam-seed/batches: {} {}",
                list_res.status(),
                list_res.text().await.unwrap_or_default()
            ));
        }
        let page: SteamSeedBatchesResponse = list_res.json().await.map_err(|e| e.to_string())?;
        for k in page.keys {
            if (to_process.len() as u32) >= max_batches {
                break;
            }
            to_process.push(k);
        }
        cursor = page.next_cursor;
        if cursor.is_none() {
            break;
        }
    }

    if to_process.is_empty() {
        return Ok(SteamSeedImportResultDto {
            batches_processed: 0,
            rows_updated: 0,
        });
    }

    let mut updates: Vec<(u32, String)> = Vec::new();
    for key in &to_process {
        let body = serde_json::json!({ "key": key }).to_string();
        let url_res = api_request(
            &ctx.base_url,
            &ctx.user_id,
            &ctx.api_key,
            "POST",
            "/steam-seed/batch/download-url",
            Some(body.as_bytes()),
        )
        .await
        .map_err(|e| format!("steam-seed/batch/download-url: {}", e))?;
        if !url_res.status().is_success() {
            return Err(format!(
                "API steam-seed/batch/download-url: {} {}",
                url_res.status(),
                url_res.text().await.unwrap_or_default()
            ));
        }
        let dl: SteamSeedBatchDownloadUrlResponse =
            url_res.json().await.map_err(|e| e.to_string())?;
        let content = API_CLIENT
            .get(&dl.download_url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !content.status().is_success() {
            return Err(format!("batch GET {}: {}", key, content.status()));
        }
        let text = content.text().await.map_err(|e| e.to_string())?;
        for line in text.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let parsed: SteamSeedBatchLine =
                serde_json::from_str(line).map_err(|e| format!("batch line parse error: {}", e))?;
            if parsed.steam_success == Some(true) {
                if let Some(data) = parsed.data {
                    let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
                    updates.push((parsed.app_id, json));
                }
            }
        }
    }

    let db = db.inner().clone();
    let rows_updated = tokio::task::spawn_blocking(move || {
        db.with_conn(|conn| apply_seed_updates(conn, &updates))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: SqliteError| e.to_string())?;

    Ok(SteamSeedImportResultDto {
        batches_processed: to_process.len() as u32,
        rows_updated,
    })
}
