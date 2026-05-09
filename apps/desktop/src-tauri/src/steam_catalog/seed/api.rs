use super::types::*;
use crate::commands::sync::api::api_request;
use crate::commands::sync::context::ApiContext;
use crate::network::API_CLIENT;
use crate::sqlite::AppDb;
use crate::steam_catalog::trending::replace_trending_app_ids;
use std::collections::HashMap;

/// Obtiene una página del listado de batches S3.
pub async fn list_batch_page(
    ctx: &ApiContext,
    list_cursor: Option<&str>,
) -> Result<SteamSeedBatchesResponse, String> {
    let path = match list_cursor {
        Some(c) => format!(
            "/steam-seed/batches?maxKeys=200&cursor={}",
            urlencoding::encode(c)
        ),
        None => "/steam-seed/batches?maxKeys=200".to_string(),
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
    list_res.json().await.map_err(|e| e.to_string())
}

/// Obtiene una página del listado de batches de reviews S3.
pub async fn list_reviews_batch_page(
    ctx: &ApiContext,
    list_cursor: Option<&str>,
) -> Result<SteamSeedBatchesResponse, String> {
    let path = match list_cursor {
        Some(c) => format!(
            "/steam-seed/reviews/batches?maxKeys=200&cursor={}",
            urlencoding::encode(c)
        ),
        None => "/steam-seed/reviews/batches?maxKeys=200".to_string(),
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
    .map_err(|e| format!("steam-seed/reviews/batches: {}", e))?;

    if !list_res.status().is_success() {
        return Err(format!(
            "API steam-seed/reviews/batches: {} {}",
            list_res.status(),
            list_res.text().await.unwrap_or_default()
        ));
    }
    list_res.json().await.map_err(|e| e.to_string())
}

/// Recopila claves de batch en orden lexicográfico ascendente desde el cursor actual.
pub async fn collect_cursor_keys(
    ctx: &ApiContext,
    last_key: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut collected = Vec::with_capacity(max_batches as usize);
    let mut list_cursor: Option<String> = None;

    'pages: loop {
        let page = list_batch_page(ctx, list_cursor.as_deref()).await?;
        for k in page.keys {
            if last_key.is_some_and(|lk| k.as_str() <= lk) {
                continue;
            }
            collected.push(k);
            if collected.len() as u32 >= max_batches {
                break 'pages;
            }
        }
        match page.next_cursor {
            Some(c) => list_cursor = Some(c),
            None => break,
        }
    }
    Ok(collected)
}

/// Recopila claves de batch de reviews en orden lexicográfico ascendente.
pub async fn collect_cursor_review_keys(
    ctx: &ApiContext,
    last_key: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut collected = Vec::with_capacity(max_batches as usize);
    let mut list_cursor: Option<String> = None;

    'pages: loop {
        let page = list_reviews_batch_page(ctx, list_cursor.as_deref()).await?;
        for k in page.keys {
            if last_key.is_some_and(|lk| k.as_str() <= lk) {
                continue;
            }
            collected.push(k);
            if collected.len() as u32 >= max_batches {
                break 'pages;
            }
        }
        match page.next_cursor {
            Some(c) => list_cursor = Some(c),
            None => break,
        }
    }
    Ok(collected)
}

/// Obtiene la lista completa de claves de batch disponibles en la nube.
pub async fn fetch_all_batch_keys(ctx: &ApiContext) -> Result<Vec<String>, String> {
    let mut all = Vec::new();
    let mut list_cursor: Option<String> = None;
    loop {
        let page = list_batch_page(ctx, list_cursor.as_deref()).await?;
        all.extend(page.keys);
        match page.next_cursor {
            Some(c) => list_cursor = Some(c),
            None => break,
        }
    }
    Ok(all)
}

/// Obtiene todas las claves de batch de reviews disponibles en la nube.
pub async fn fetch_all_review_batch_keys(ctx: &ApiContext) -> Result<Vec<String>, String> {
    let mut all = Vec::new();
    let mut list_cursor: Option<String> = None;
    loop {
        let page = list_reviews_batch_page(ctx, list_cursor.as_deref()).await?;
        all.extend(page.keys);
        match page.next_cursor {
            Some(c) => list_cursor = Some(c),
            None => break,
        }
    }
    Ok(all)
}

/// Recopila claves de batch priorizando las más recientes.
pub async fn collect_newest_first_keys(
    ctx: &ApiContext,
    watermark: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut all = fetch_all_batch_keys(ctx).await?;
    all.sort_unstable_by(|a, b| b.cmp(a));
    if let Some(w) = watermark {
        all.retain(|k| k.as_str() < w);
    }
    all.truncate(max_batches as usize);
    Ok(all)
}

/// Recopila claves de batch de reviews priorizando las más recientes.
pub async fn collect_newest_first_review_keys(
    ctx: &ApiContext,
    watermark: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut all = fetch_all_review_batch_keys(ctx).await?;
    all.sort_unstable_by(|a, b| b.cmp(a));
    if let Some(w) = watermark {
        all.retain(|k| k.as_str() < w);
    }
    all.truncate(max_batches as usize);
    Ok(all)
}

/// Resuelve las URLs de descarga pre-firmadas para un conjunto de claves en una
/// sola llamada al API (bulk).
pub async fn resolve_batch_download_urls(
    ctx: &ApiContext,
    keys: &[String],
) -> Result<HashMap<String, String>, String> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }

    let body = serde_json::json!({ "keys": keys }).to_string();
    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/steam-seed/batch/download-url",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("steam-seed/batch/download-url (bulk): {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "API steam-seed/batch/download-url (bulk): {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

    let bulk: SteamSeedBatchDownloadUrlsResponse = res.json().await.map_err(|e| e.to_string())?;

    Ok(bulk
        .results
        .into_iter()
        .filter_map(|r| r.url.map(|u| (r.key, u)))
        .collect())
}

/// Resuelve URLs pre-firmadas para batches de reviews.
pub async fn resolve_reviews_batch_download_urls(
    ctx: &ApiContext,
    keys: &[String],
) -> Result<HashMap<String, String>, String> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }

    let body = serde_json::json!({ "keys": keys }).to_string();
    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/steam-seed/reviews/batch/download-url",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("steam-seed/reviews/batch/download-url (bulk): {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "API steam-seed/reviews/batch/download-url (bulk): {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

    let bulk: SteamSeedBatchDownloadUrlsResponse = res.json().await.map_err(|e| e.to_string())?;

    Ok(bulk
        .results
        .into_iter()
        .filter_map(|r| r.url.map(|u| (r.key, u)))
        .collect())
}

/// Descarga `priority_appids.jsonl` desde la nube y reemplaza
/// `steam_catalog_trending` en SQLite.
pub async fn sync_apply_cloud_priority_trending(
    db: &AppDb,
    ctx: &ApiContext,
) -> Result<usize, String> {
    let url_res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/steam-seed/priority/download-url",
        None,
    )
    .await
    .map_err(|e| e.to_string())?;

    if !url_res.status().is_success() {
        return Ok(0);
    }

    let dl: SteamSeedPriorityDownloadUrlResponse =
        url_res.json().await.map_err(|e| e.to_string())?;

    let content = API_CLIENT
        .get(&dl.download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !content.status().is_success() {
        return Ok(0);
    }

    let text = content.text().await.map_err(|e| e.to_string())?;
    let ids: Vec<u32> = text
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .filter(|&id| id > 0)
        .collect();

    if ids.is_empty() {
        return Ok(0);
    }

    let n = ids.len();
    let db_clone = db.clone();

    tokio::task::spawn_blocking(move || {
        db_clone.with_conn(|c| {
            replace_trending_app_ids(c, &ids)?;
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    Ok(n)
}
