use super::request::seed_api_request;
use super::request::validate_presigned_url;
use super::types::*;
use crate::cloud::api_error;
use crate::network::DATA_CLIENT;
use crate::sqlite::AppDb;
use crate::steam_catalog::trending::replace_trending_app_ids;
use std::collections::HashMap;

/// Obtiene una página del listado de batches S3.
pub async fn list_batch_page(
    list_cursor: Option<&str>,
    start_after: Option<&str>,
) -> Result<SteamSeedBatchesResponse, String> {
    let path = match (list_cursor, start_after) {
        (Some(c), _) => format!(
            "/steam-seed/batches?maxKeys=200&cursor={}",
            urlencoding::encode(c)
        ),
        (None, Some(key)) => format!(
            "/steam-seed/batches?maxKeys=200&startAfter={}",
            urlencoding::encode(key)
        ),
        (None, None) => "/steam-seed/batches?maxKeys=200".to_string(),
    };

    let list_res = seed_api_request(reqwest::Method::GET, &path, None)
        .await
        .map_err(|e| format!("steam-seed/batches: {}", e))?;

    if !list_res.status().is_success() {
        return Err(api_error::response_message(list_res).await);
    }
    list_res.json().await.map_err(|e| e.to_string())
}

/// Obtiene una página del listado de batches de reviews S3.
pub async fn list_reviews_batch_page(
    list_cursor: Option<&str>,
    start_after: Option<&str>,
) -> Result<SteamSeedBatchesResponse, String> {
    let path = match (list_cursor, start_after) {
        (Some(c), _) => format!(
            "/steam-seed/reviews/batches?maxKeys=200&cursor={}",
            urlencoding::encode(c)
        ),
        (None, Some(key)) => format!(
            "/steam-seed/reviews/batches?maxKeys=200&startAfter={}",
            urlencoding::encode(key)
        ),
        (None, None) => "/steam-seed/reviews/batches?maxKeys=200".to_string(),
    };

    let list_res = seed_api_request(reqwest::Method::GET, &path, None)
        .await
        .map_err(|e| format!("steam-seed/reviews/batches: {}", e))?;

    if !list_res.status().is_success() {
        return Err(api_error::response_message(list_res).await);
    }
    list_res.json().await.map_err(|e| e.to_string())
}

/// Recopila claves de batch en orden lexicográfico ascendente desde el cursor actual.
pub async fn collect_cursor_keys(
    last_key: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut collected = Vec::with_capacity(max_batches as usize);
    let mut list_cursor: Option<String> = None;

    'pages: loop {
        let page = list_batch_page(
            list_cursor.as_deref(),
            list_cursor.is_none().then_some(last_key).flatten(),
        )
        .await?;
        for k in page.keys {
            if list_cursor.is_none() && last_key.is_some_and(|lk| k.as_str() <= lk) {
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
    last_key: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut collected = Vec::with_capacity(max_batches as usize);
    let mut list_cursor: Option<String> = None;

    'pages: loop {
        let page = list_reviews_batch_page(
            list_cursor.as_deref(),
            list_cursor.is_none().then_some(last_key).flatten(),
        )
        .await?;
        for k in page.keys {
            if list_cursor.is_none() && last_key.is_some_and(|lk| k.as_str() <= lk) {
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
pub async fn fetch_all_batch_keys() -> Result<Vec<String>, String> {
    let mut all = Vec::new();
    let mut list_cursor: Option<String> = None;
    loop {
        let page = list_batch_page(list_cursor.as_deref(), None).await?;
        all.extend(page.keys);
        match page.next_cursor {
            Some(c) => list_cursor = Some(c),
            None => break,
        }
    }
    Ok(all)
}

/// Obtiene todas las claves de batch de reviews disponibles en la nube.
pub async fn fetch_all_review_batch_keys() -> Result<Vec<String>, String> {
    let mut all = Vec::new();
    let mut list_cursor: Option<String> = None;
    loop {
        let page = list_reviews_batch_page(list_cursor.as_deref(), None).await?;
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
    watermark: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut all = fetch_all_batch_keys().await?;
    all.sort_unstable_by(|a, b| b.cmp(a));
    if let Some(w) = watermark {
        all.retain(|k| k.as_str() < w);
    }
    all.truncate(max_batches as usize);
    Ok(all)
}

/// Recopila claves de batch de reviews priorizando las más recientes.
pub async fn collect_newest_first_review_keys(
    watermark: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut all = fetch_all_review_batch_keys().await?;
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
    keys: &[String],
) -> Result<HashMap<String, String>, String> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }

    let body = serde_json::json!({ "keys": keys }).to_string();
    let res = seed_api_request(
        reqwest::Method::POST,
        "/steam-seed/batch/download-url",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("steam-seed/batch/download-url (bulk): {}", e))?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
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
    keys: &[String],
) -> Result<HashMap<String, String>, String> {
    if keys.is_empty() {
        return Ok(HashMap::new());
    }

    let body = serde_json::json!({ "keys": keys }).to_string();
    let res = seed_api_request(
        reqwest::Method::POST,
        "/steam-seed/reviews/batch/download-url",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("steam-seed/reviews/batch/download-url (bulk): {}", e))?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
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
pub async fn sync_apply_cloud_priority_trending(db: &AppDb) -> Result<usize, String> {
    let url_res = seed_api_request(
        reqwest::Method::POST,
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

    validate_presigned_url(&dl.download_url)?;

    let content = DATA_CLIENT
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
