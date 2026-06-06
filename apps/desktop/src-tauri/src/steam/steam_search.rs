//! Resolución de identificadores, nombres y metadata de aplicaciones de Steam.
//!
//! Proporciona mecanismos para:
//!
//! - Buscar dinámicamente el App ID a partir del nombre del juego.
//! - Resolver el nombre del juego a partir de un App ID.
//! - Obtener metadata asociada, como imágenes, videos y otros recursos.
//!
//! Facilita la integración con servicios que requieren identificación
//! consistente y enriquecimiento de datos dentro del ecosistema de Steam.

use rusqlite::Connection;
use tauri::State;

use crate::network::get_steam_client;
use crate::sqlite::error::SqliteError;
use crate::sqlite::AppDb;
use crate::steam::appdetails::fetch_steam_app_details_from_store;
use crate::steam::appdetails::fetch_steam_appdetails_media_from_store;
use crate::steam::appdetails::parse_media_from_data;
use crate::steam::appdetails::steam_app_details_from_store_data;
use crate::steam_cache::{
    normalize_steam_app_id, normalize_steam_appdetails_media, steam_api_cache,
};
use crate::steam_catalog::normalize::normalize_catalog_name;
use futures_util::stream::{self, StreamExt};
use regex::{Regex, RegexBuilder};
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

pub use crate::steam_cache::{SteamAppDetails, SteamAppdetailsMedia};

static APP_ID_REGEX: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"/app/(\d{4,10})/"#).unwrap());
static SUGGEST_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    RegexBuilder::new(r#"<a[^>]+data-ds-appid="(\d{4,10})"[^>]*>(.*?)</a>"#)
        .dot_matches_new_line(true)
        .build()
        .unwrap()
});
static NAME_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"class="[^"]*match_name[^"]*"[^>]*>([^<]+)<"#).unwrap());

const STEAM_CONCURRENCY_LIMIT: usize = 3;

/// Caché persistente en `steam_appdetails_media_cache` (JSON de `SteamAppdetailsMedia`).
fn load_persistent_media_cache_map(
    conn: &Connection,
    app_ids: &[String],
) -> Result<HashMap<String, SteamAppdetailsMedia>, rusqlite::Error> {
    let pids: Vec<i64> = app_ids.iter().filter_map(|s| s.parse().ok()).collect();
    if pids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = pids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
            "SELECT app_id, media_json FROM steam_appdetails_media_cache WHERE app_id IN ({placeholders})"
        );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(pids.iter().copied()))?;
    let mut out = HashMap::new();
    while let Some(row) = rows.next()? {
        let pid: i64 = row.get(0)?;
        let json: String = row.get(1)?;
        if let Ok(media) = serde_json::from_str::<SteamAppdetailsMedia>(&json) {
            out.insert(pid.to_string(), media);
        }
    }
    Ok(out)
}

fn upsert_persistent_media_cache_batch(
    conn: &Connection,
    items: &[(String, SteamAppdetailsMedia)],
) -> Result<(), rusqlite::Error> {
    if items.is_empty() {
        return Ok(());
    }

    conn.execute_batch("BEGIN IMMEDIATE;")?;

    let result: Result<(), rusqlite::Error> = (|| {
        let mut stmt = conn.prepare_cached(
            "INSERT INTO steam_appdetails_media_cache (app_id, media_json, updated_at) \
                VALUES (?1, ?2, unixepoch()) \
                ON CONFLICT(app_id) DO UPDATE SET \
                media_json = excluded.media_json, updated_at = unixepoch()",
        )?;

        for (id, media) in items {
            let Ok(pid) = id.parse::<i64>() else {
                continue;
            };
            let media = normalize_steam_appdetails_media(media.clone());
            let Ok(json) = serde_json::to_string(&media) else {
                continue;
            };
            stmt.execute((pid, json))?;
        }
        Ok(())
    })();

    match result {
        Ok(_) => conn.execute_batch("COMMIT;")?,
        Err(e) => {
            conn.execute_batch("ROLLBACK;")?;
            return Err(e);
        }
    }

    Ok(())
}

/// Disco (tabla dedicada) y luego `details_json` del catálogo; el catálogo sobrescribe si ambos existen.
fn load_combined_media_from_db(
    conn: &Connection,
    app_ids: &[String],
) -> Result<HashMap<String, SteamAppdetailsMedia>, rusqlite::Error> {
    let mut out = load_persistent_media_cache_map(conn, app_ids)?;
    let missing: Vec<String> = app_ids
        .iter()
        .filter(|id| !out.contains_key(*id))
        .cloned()
        .collect();
    if missing.is_empty() {
        return Ok(out);
    }
    let from_catalog = load_catalog_media_map(conn, &missing)?;
    for (k, v) in from_catalog {
        out.insert(k, v);
    }
    Ok(out
        .into_iter()
        .map(|(k, v)| (k, normalize_steam_appdetails_media(v)))
        .collect())
}

/// Medios ya enriquecidos en el catálogo local (`details_json`); evita golpear la Store.
fn load_catalog_media_map(
    conn: &Connection,
    app_ids: &[String],
) -> Result<HashMap<String, SteamAppdetailsMedia>, rusqlite::Error> {
    let pids: Vec<i64> = app_ids.iter().filter_map(|s| s.parse().ok()).collect();
    if pids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = pids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT app_id, details_json FROM steam_catalog_apps WHERE app_id IN ({placeholders}) AND details_json IS NOT NULL"
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(pids.iter().copied()))?;

    let mut out = HashMap::new();

    while let Some(row) = rows.next()? {
        let pid: i64 = row.get(0)?;
        let json: String = row.get(1)?;

        if json.trim().is_empty() {
            continue;
        }

        if let Ok(details) = serde_json::from_str::<SteamAppDetails>(&json) {
            out.insert(pid.to_string(), details.media);
            continue;
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
            if v.as_object().is_some() {
                out.insert(pid.to_string(), parse_media_from_data(&v));
            }
        }
    }
    Ok(out)
}

/// Nombres presentes en `steam_appdetails_media_cache` (p. ej. tras import seed o fetch previo).
fn load_names_from_media_cache(
    conn: &Connection,
    app_ids: &[String],
) -> Result<HashMap<String, String>, rusqlite::Error> {
    let pids: Vec<i64> = app_ids.iter().filter_map(|s| s.parse().ok()).collect();
    if pids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = pids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT app_id, json_extract(media_json, '$.name') FROM steam_appdetails_media_cache WHERE app_id IN ({placeholders})"
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(pids.iter().copied()))?;

    let mut out = HashMap::new();
    while let Some(row) = rows.next()? {
        let pid: i64 = row.get(0)?;
        let name: Option<String> = row.get(1)?;

        if let Some(n) = name {
            let trimmed = n.trim();
            if !trimmed.is_empty() {
                out.insert(pid.to_string(), trimmed.to_string());
            }
        }
    }
    Ok(out)
}

async fn fetch_name_and_media_from_store(app_id: &str) -> Option<(String, SteamAppdetailsMedia)> {
    let media = fetch_steam_appdetails_media_from_store(app_id).await.ok()?;
    if media.name.trim().is_empty() {
        return None;
    }
    Some((app_id.to_string(), media))
}

/// Nombres ya presentes en catálogo local; evita golpear Store innecesariamente.
fn load_catalog_names_map(
    conn: &Connection,
    app_ids: &[String],
) -> Result<HashMap<String, String>, rusqlite::Error> {
    let pids: Vec<i64> = app_ids
        .iter()
        .filter_map(|s| s.parse::<i64>().ok())
        .collect();
    if pids.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = pids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT app_id, name FROM steam_catalog_apps \
            WHERE app_id IN ({placeholders}) \
            AND name IS NOT NULL AND length(trim(name)) > 0"
    );

    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(pids.iter().copied()))?;
    let mut out = HashMap::new();
    while let Some(row) = rows.next()? {
        let pid: i64 = row.get(0)?;
        let name: String = row.get(1)?;
        out.insert(pid.to_string(), name);
    }
    Ok(out)
}

fn upsert_catalog_details_from_store(
    conn: &Connection,
    app_id: &str,
    details: &SteamAppDetails,
) -> Result<(), rusqlite::Error> {
    let Ok(pid) = app_id.parse::<i64>() else {
        return Ok(());
    };
    if pid <= 0 {
        return Ok(());
    }

    let name = if details.name.trim().is_empty() {
        format!("App {pid}")
    } else {
        details.name.trim().to_string()
    };
    let name_normalized = normalize_catalog_name(&name);
    let details_json = serde_json::to_string(details).unwrap_or_else(|_| "{}".to_string());

    conn.execute(
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
            rusqlite::params![pid, name, name_normalized, details_json],
        )?;
    Ok(())
}

fn load_catalog_details_json(
    conn: &Connection,
    app_id: &str,
) -> Result<Option<String>, rusqlite::Error> {
    let Ok(pid) = app_id.parse::<i64>() else {
        return Ok(None);
    };
    match conn.query_row(
        "SELECT details_json FROM steam_catalog_apps WHERE app_id = ?1 AND details_json IS NOT NULL",
        [pid],
        |row| row.get::<_, String>(0),
    ) {
        Ok(v) => {
             if v.trim().is_empty() {
                 Ok(None)
             } else {
                 Ok(Some(v))
             }
        },
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

async fn get_steam_app_names_batch_impl(
    db: AppDb,
    app_ids: Vec<String>,
) -> HashMap<String, String> {
    let mut valid_ids: Vec<String> = app_ids
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
        .collect();

    valid_ids.sort_unstable();
    valid_ids.dedup();

    if valid_ids.is_empty() {
        return HashMap::new();
    }

    // 1. RAM cache primero — sin tocar disco ni red.
    let cache = steam_api_cache();
    let mut final_map: HashMap<String, String> = HashMap::new();
    let mut ids_missing_ram: Vec<String> = Vec::new();

    for id in &valid_ids {
        if let Some(media) = cache.get_media(id) {
            if !media.name.trim().is_empty() {
                final_map.insert(id.clone(), media.name.clone());
                continue;
            }
        }
        ids_missing_ram.push(id.clone());
    }

    if ids_missing_ram.is_empty() {
        return final_map;
    }

    // 2. SQLite (catálogo + media cache) para los que no estaban en RAM.
    let db_for_persist = db.clone();
    let ids_for_db = ids_missing_ram.clone();

    let from_db = tokio::task::spawn_blocking(move || {
        db.with_conn(|c| {
            let mut m = load_catalog_names_map(c, &ids_for_db)?;
            let missing: Vec<String> = ids_for_db
                .iter()
                .filter(|id| !m.contains_key(*id))
                .cloned()
                .collect();
            if !missing.is_empty() {
                let from_media = load_names_from_media_cache(c, &missing)?;
                for (k, v) in from_media {
                    m.insert(k, v);
                }
            }
            Ok::<_, rusqlite::Error>(m)
        })
    })
    .await
    .ok()
    .and_then(|r| r.ok())
    .unwrap_or_default();

    // Poblar RAM cache con lo que vino de DB.
    for (id, name) in &from_db {
        if let Some(mut media) = cache.get_media(id) {
            if media.name.trim().is_empty() {
                media.name = name.clone();
                cache.insert_media(id.clone(), media);
            }
        }
        final_map.insert(id.clone(), name.clone());
    }

    let ids_to_fetch: Vec<String> = ids_missing_ram
        .into_iter()
        .filter(|id| !final_map.contains_key(id))
        .collect();

    if ids_to_fetch.is_empty() {
        return final_map;
    }

    // 3. Steam Store API solo para los que no están en ningún caché.
    //    Sin sleep entre reintentos en el camino feliz; el retry solo
    //    ocurre si el primer intento falla (evita +250 ms innecesarios).
    let stream = futures_util::stream::iter(ids_to_fetch.into_iter().map(|app_id| async move {
        if let Some(result) = fetch_name_and_media_from_store(&app_id).await {
            return Some(result);
        }
        // Un único reintento con backoff mínimo solo si el primer fallo no fue 404.
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        fetch_name_and_media_from_store(&app_id).await
    }))
    .buffer_unordered(STEAM_CONCURRENCY_LIMIT);

    let results: Vec<Option<(String, SteamAppdetailsMedia)>> = stream.collect().await;

    let mut to_persist: Vec<(String, SteamAppdetailsMedia)> = Vec::new();
    for item in results.into_iter().flatten() {
        let (id, media) = item;
        cache.insert_media(id.clone(), media.clone());
        final_map.insert(id.clone(), media.name.clone());
        to_persist.push((id, media));
    }

    if !to_persist.is_empty() {
        let _ = tokio::task::spawn_blocking(move || {
            db_for_persist.with_conn(|c| upsert_persistent_media_cache_batch(c, &to_persist))
        })
        .await;
    }

    final_map
}

#[tauri::command]
pub async fn get_steam_app_names_batch(
    db: State<'_, AppDb>,
    app_ids: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    Ok(get_steam_app_names_batch_impl(db.inner().clone(), app_ids).await)
}

#[tauri::command]
pub async fn get_steam_app_name(
    db: State<'_, AppDb>,
    app_id: String,
) -> Result<Option<String>, String> {
    let Some(app_id) = normalize_steam_app_id(&app_id) else {
        return Ok(None);
    };

    let mut results =
        get_steam_app_names_batch_impl(db.inner().clone(), vec![app_id.clone()]).await;
    Ok(results.remove(&app_id))
}

async fn search_steam_app_id_impl(query: String) -> Option<String> {
    let term = query.replace('-', " ");
    let url = format!(
        "https://store.steampowered.com/search/suggest?term={}&f=games&cc=US&l=spanish",
        urlencoding::encode(&term)
    );

    let body = get_steam_client()
        .get(&url)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    APP_ID_REGEX
        .captures_iter(&body)
        .next()
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
}

#[tauri::command]
pub async fn search_steam_app_id(query: String) -> Option<String> {
    let query = query.trim();
    if query.is_empty() {
        return None;
    }
    search_steam_app_id_impl(query.to_string()).await
}

#[tauri::command]
pub async fn search_steam_app_ids_batch(queries: Vec<String>) -> Vec<Option<String>> {
    if queries.is_empty() {
        return Vec::new();
    }

    let trimmed: Vec<String> = queries.into_iter().map(|q| q.trim().to_string()).collect();

    let stream = futures_util::stream::iter(trimmed.into_iter().map(|q| async move {
        if q.is_empty() {
            None
        } else {
            search_steam_app_id_impl(q).await
        }
    }))
    .buffer_unordered(5);

    stream.collect().await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSearchResult {
    pub steam_app_id: String,
    pub name: String,
}

#[tauri::command]
pub async fn search_steam_games(query: String) -> Vec<SteamSearchResult> {
    let query = query.trim();
    if query.len() < 3 {
        return Vec::new();
    }

    let term = query.replace('-', " ");
    let url = format!(
        "https://store.steampowered.com/search/suggest?term={}&f=games&cc=US&l=spanish",
        urlencoding::encode(&term)
    );

    let body = match get_steam_client().get(&url).send().await {
        Ok(resp) => resp.text().await.unwrap_or_default(),
        Err(_) => return Vec::new(),
    };

    let mut results = Vec::new();

    for cap in SUGGEST_REGEX.captures_iter(&body) {
        let app_id = match cap.get(1) {
            Some(m) => m.as_str().to_string(),
            None => continue,
        };
        let inner = cap.get(2).map(|m| m.as_str()).unwrap_or("");

        let name = match NAME_REGEX.captures(inner) {
            Some(c) => c
                .get(1)
                .map(|m| m.as_str().trim().to_string())
                .unwrap_or_default(),
            None => String::new(),
        };

        if name.is_empty() {
            continue;
        }
        results.push(SteamSearchResult {
            steam_app_id: app_id,
            name,
        });
    }

    results
}

#[tauri::command]
pub async fn get_steam_appdetails_media(
    db: State<'_, AppDb>,
    app_id: String,
) -> Result<SteamAppdetailsMedia, String> {
    let Some(app_id) = normalize_steam_app_id(&app_id) else {
        return Err("App ID inválido".to_string());
    };

    if let Some(cached) = steam_api_cache().get_media(&app_id) {
        return Ok(cached);
    }

    let db_conn = db.inner().clone();
    let id_for_db = app_id.clone();
    let from_db = tokio::task::spawn_blocking(move || {
        db_conn.with_conn(|c| load_combined_media_from_db(c, std::slice::from_ref(&id_for_db)))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: SqliteError| e.to_string())?;

    if let Some(media) = from_db.get(&app_id).cloned() {
        steam_api_cache().insert_media(app_id.clone(), media.clone());
        return Ok(media);
    }

    let result = fetch_steam_appdetails_media_from_store(&app_id).await?;
    steam_api_cache().insert_media(app_id.clone(), result.clone());

    let db_persist = db.inner().clone();
    let id_copy = app_id.clone();
    let res_clone = result.clone();
    let _ = tokio::task::spawn_blocking(move || {
        db_persist.with_conn(|c| upsert_persistent_media_cache_batch(c, &[(id_copy, res_clone)]))
    })
    .await;

    Ok(result)
}

#[tauri::command]
pub async fn get_steam_appdetails_media_batch(
    db: State<'_, AppDb>,
    app_ids: Vec<String>,
) -> Result<HashMap<String, SteamAppdetailsMedia>, String> {
    let mut seen = HashSet::new();
    let valid_ids: Vec<String> = app_ids
        .into_iter()
        .filter_map(|id| {
            let id = normalize_steam_app_id(&id)?;
            if seen.insert(id.clone()) {
                Some(id)
            } else {
                None
            }
        })
        .collect();

    if valid_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut final_results = HashMap::new();
    let mut missing_after_cache = Vec::new();

    let cache = steam_api_cache();
    for id in valid_ids {
        if let Some(cached_data) = cache.get_media(&id) {
            final_results.insert(id, cached_data);
        } else {
            missing_after_cache.push(id);
        }
    }

    if !missing_after_cache.is_empty() {
        let db_load = db.inner().clone();
        let ids_for_db = missing_after_cache.clone();
        let from_db = tokio::task::spawn_blocking(move || {
            db_load.with_conn(|c| load_combined_media_from_db(c, &ids_for_db))
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e: SqliteError| e.to_string())?;

        let api_cache = steam_api_cache();
        for (id, media) in from_db {
            api_cache.insert_media(id.clone(), media.clone());
            final_results.insert(id, media);
        }
    }

    let ids_to_fetch: Vec<String> = missing_after_cache
        .into_iter()
        .filter(|id| !final_results.contains_key(id))
        .collect();

    if ids_to_fetch.is_empty() {
        return Ok(final_results);
    }

    let empty = SteamAppdetailsMedia {
        media_urls: Vec::new(),
        video_url: None,
        genres: Vec::new(),
        name: String::new(),
        capsule_image: None,
    };

    let stream = stream::iter(ids_to_fetch.into_iter().map(|app_id| async move {
        let result = fetch_steam_appdetails_media_from_store(&app_id).await;
        (app_id, result)
    }))
    .buffer_unordered(STEAM_CONCURRENCY_LIMIT);

    let fetched: Vec<(String, Result<SteamAppdetailsMedia, String>)> = stream.collect().await;

    let mut to_persist: Vec<(String, SteamAppdetailsMedia)> = Vec::new();
    let api_cache = steam_api_cache();

    for (app_id, result) in fetched {
        let media = match result {
            Ok(m) => {
                to_persist.push((app_id.clone(), m.clone()));
                m
            }
            Err(_) => empty.clone(),
        };
        api_cache.insert_media(app_id.clone(), media.clone());
        final_results.insert(app_id, media);
    }

    if !to_persist.is_empty() {
        let db_persist = db.inner().clone();
        let _ = tokio::task::spawn_blocking(move || {
            db_persist.with_conn(|c| upsert_persistent_media_cache_batch(c, &to_persist))
        })
        .await;
    }

    Ok(final_results)
}

/// Obtiene la ficha completa de un juego de Steam por su App ID.
///
/// # Errors
///
/// Retorna `Err` si el `app_id` no es numérico, si hay error de red,
/// o si Steam no tiene datos para esa app.
#[tauri::command]
pub async fn get_steam_app_details(
    db: State<'_, AppDb>,
    app_id: String,
) -> Result<SteamAppDetails, String> {
    let Some(app_id) = normalize_steam_app_id(&app_id) else {
        return Err("App ID inválido".to_string());
    };

    if let Some(cached) = steam_api_cache().get_details(&app_id) {
        return Ok(cached);
    }

    let db_for_read = db.inner().clone();
    let app_id_for_read = app_id.clone();
    let from_sqlite = tokio::task::spawn_blocking(move || {
        db_for_read.with_conn(|c| load_catalog_details_json(c, &app_id_for_read))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: SqliteError| e.to_string())?;

    if let Some(details_json) = from_sqlite {
        if let Ok(details) = serde_json::from_str::<SteamAppDetails>(&details_json) {
            steam_api_cache().insert_details(app_id.clone(), details.clone());
            return Ok(details);
        }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&details_json) {
            if v.as_object().is_some() {
                let details = steam_app_details_from_store_data(&v);
                steam_api_cache().insert_details(app_id.clone(), details.clone());
                return Ok(details);
            }
        }
    }

    let result = fetch_steam_app_details_from_store(&app_id).await?;

    steam_api_cache().insert_details(app_id.clone(), result.clone());

    let db_write = db.inner().clone();
    let app_id_for_db = app_id.clone();
    let details_for_db = result.clone();

    let db_task = tokio::task::spawn_blocking(move || {
        db_write
            .with_conn(|c| upsert_catalog_details_from_store(c, &app_id_for_db, &details_for_db))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: SqliteError| e.to_string());

    let _ = db_task;

    Ok(result)
}

#[cfg(test)]
mod media_cache_tests {
    use super::*;
    use crate::sqlite::run_migrations;
    use rusqlite::Connection;

    #[test]
    fn persistent_media_cache_roundtrips() {
        let conn = Connection::open_in_memory().expect("in memory");
        run_migrations(&conn).expect("migrate");
        let m = SteamAppdetailsMedia {
            media_urls: vec!["https://x/img.png".to_string()],
            video_url: None,
            genres: vec!["Acción".to_string()],
            name: "Test".to_string(),
            capsule_image: None,
        };
        upsert_persistent_media_cache_batch(&conn, &[("730".to_string(), m.clone())])
            .expect("upsert");
        let map = load_persistent_media_cache_map(&conn, &["730".to_string()]).expect("load");
        assert_eq!(map.get("730").unwrap().name, "Test");
        assert_eq!(map.get("730").unwrap().genres, vec!["Acción".to_string()]);
    }

    #[test]
    fn combined_load_includes_persistent_table() {
        let conn = Connection::open_in_memory().expect("in memory");
        run_migrations(&conn).expect("migrate");
        let m = SteamAppdetailsMedia {
            media_urls: vec![],
            video_url: None,
            genres: vec![],
            name: "FromDisk".to_string(),
            capsule_image: None,
        };
        upsert_persistent_media_cache_batch(&conn, &[("440".to_string(), m)]).expect("upsert");
        let map = load_combined_media_from_db(&conn, &["440".to_string()]).expect("combined");
        assert_eq!(map.get("440").unwrap().name, "FromDisk");
    }

    #[test]
    fn catalog_media_map_accepts_store_data_json_from_seed() {
        let conn = Connection::open_in_memory().expect("in memory");
        run_migrations(&conn).expect("migrate");
        let raw = r#"{"name":"Seed Game","header_image":"https://cdn.example/header.jpg","screenshots":[]}"#;
        conn.execute(
                "INSERT INTO steam_catalog_apps (app_id, name, name_normalized, details_json, last_sync_batch_at)
                VALUES (999001, 'x', 'x', ?1, unixepoch())",
                [raw],
            )
            .expect("insert");
        let map = load_catalog_media_map(&conn, &["999001".to_string()]).expect("load");
        assert_eq!(map.get("999001").unwrap().name, "Seed Game");
    }
}
