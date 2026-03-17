//! Búsqueda dinámica de Steam App ID por nombre y resolución de App ID a nombre.

use futures_util::StreamExt;
use regex::{Regex, RegexBuilder};
use std::collections::HashMap;
use std::sync::LazyLock;

static STEAM_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .expect("Fallo al construir el cliente HTTP de Steam")
});

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

async fn fetch_single_app_name(app_id: &str) -> Option<(String, String)> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}",
        app_id
    );

    let res = STEAM_CLIENT.get(&url).send().await.ok()?;
    let data: serde_json::Value = res.json().await.ok()?;

    let entry = data.get(app_id)?;
    if entry.get("success")?.as_bool()? {
        let name = entry.get("data")?.get("name")?.as_str()?;
        return Some((app_id.to_string(), name.to_string()));
    }

    None
}

/// Obtiene los nombres de varios juegos a partir de sus Steam App IDs.
/// Hace peticiones en paralelo controladas para evitar baneos.
#[tauri::command]
pub async fn get_steam_app_names_batch(app_ids: Vec<String>) -> HashMap<String, String> {
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

    // Disparamos las peticiones con un límite de concurrencia
    let stream = futures_util::stream::iter(valid_ids.into_iter().map(|app_id| async move {
        for _ in 0..2 {
            if let Some(result) = fetch_single_app_name(&app_id).await {
                return Some(result);
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
        None
    }))
    .buffer_unordered(STEAM_CONCURRENCY_LIMIT);

    let results: Vec<Option<(String, String)>> = stream.collect().await;

    let mut final_map = HashMap::new();
    for (id, name) in results.into_iter().flatten() {
        final_map.insert(id, name);
    }

    final_map
}

/// Obtiene el nombre del juego a partir del Steam App ID.
#[tauri::command]
pub async fn get_steam_app_name(app_id: String) -> Option<String> {
    let app_id = app_id.trim().to_string();
    if app_id.is_empty() || !app_id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    let mut results = get_steam_app_names_batch(vec![app_id.clone()]).await;
    results.remove(&app_id)
}

/// Lógica interna: busca Steam App ID por texto de búsqueda (una petición HTTP).
async fn search_steam_app_id_impl(query: String) -> Option<String> {
    let term = query.replace('-', " ");
    let url = format!(
        "https://store.steampowered.com/search/suggest?term={}&f=games&cc=US&l=english",
        urlencoding::encode(&term)
    );

    let body = STEAM_CLIENT
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

/// Busca el Steam App ID por nombre usando el endpoint de sugerencias de Steam.
#[tauri::command]
pub async fn search_steam_app_id(query: String) -> Option<String> {
    let query = query.trim();
    if query.is_empty() {
        return None;
    }
    search_steam_app_id_impl(query.to_string()).await
}

/// Busca Steam App IDs para varias consultas en paralelo de forma controlada.
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

/// Busca varios juegos en Steam por nombre usando el endpoint de sugerencias.
#[tauri::command]
pub async fn search_steam_games(query: String) -> Vec<SteamSearchResult> {
    let query = query.trim();
    if query.len() < 3 {
        return Vec::new();
    }

    let term = query.replace('-', " ");
    let url = format!(
        "https://store.steampowered.com/search/suggest?term={}&f=games&cc=US&l=english",
        urlencoding::encode(&term)
    );

    let body = match STEAM_CLIENT.get(&url).send().await {
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

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamAppdetailsMedia {
    pub media_urls: Vec<String>,
    pub video_url: Option<String>,
}

async fn fetch_steam_appdetails_media_impl(app_id: &str) -> Result<SteamAppdetailsMedia, String> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}&l=english",
        app_id
    );

    let res = STEAM_CLIENT
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Request: {}", e))?;
    let data: serde_json::Value = res.json().await.map_err(|e| format!("JSON: {}", e))?;

    let success = data
        .get(app_id)
        .and_then(|e| e.get("success"))
        .and_then(|e| e.as_bool())
        .unwrap_or(false);

    if !success {
        return Ok(SteamAppdetailsMedia {
            media_urls: Vec::new(),
            video_url: None,
        });
    }

    let data_obj = match data.get(app_id).and_then(|e| e.get("data")) {
        Some(d) => d,
        None => {
            return Ok(SteamAppdetailsMedia {
                media_urls: Vec::new(),
                video_url: None,
            })
        }
    };

    let mut media_urls = Vec::new();
    let mut video_url: Option<String> = None;

    if let Some(s) = data_obj.get("header_image").and_then(|v| v.as_str()) {
        if !s.is_empty() {
            media_urls.push(s.to_string());
        }
    }

    if let Some(arr) = data_obj.get("screenshots").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(path) = item.get("path_full").and_then(|v| v.as_str()) {
                if !path.is_empty() && !media_urls.contains(&path.to_string()) {
                    media_urls.push(path.to_string());
                }
            }
        }
    }

    if let Some(arr) = data_obj.get("movies").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(thumb) = item.get("thumbnail").and_then(|v| v.as_str()) {
                if !thumb.is_empty() && !media_urls.contains(&thumb.to_string()) {
                    media_urls.push(thumb.to_string());
                }
            }
            if video_url.is_none() {
                let u = item
                    .get("hls_h264")
                    .and_then(|v| v.as_str())
                    .map(String::from)
                    .or_else(|| {
                        item.get("dash_h264")
                            .and_then(|v| v.as_str())
                            .map(String::from)
                    })
                    .or_else(|| {
                        item.get("webm").and_then(|webm| {
                            webm.get("max")
                                .or_else(|| webm.get("480"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        })
                    })
                    .or_else(|| {
                        item.get("mp4").and_then(|mp4| {
                            mp4.get("max")
                                .or_else(|| mp4.get("480"))
                                .and_then(|v| v.as_str())
                                .map(String::from)
                        })
                    });

                if let Some(url) = u.filter(|url| !url.is_empty()) {
                    video_url = Some(url);
                }
            }
        }
    }

    Ok(SteamAppdetailsMedia {
        media_urls,
        video_url,
    })
}

#[tauri::command]
pub async fn get_steam_appdetails_media(app_id: String) -> Result<SteamAppdetailsMedia, String> {
    let app_id = app_id.trim().to_string();
    if app_id.is_empty() || !app_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("App ID inválido".to_string());
    }

    fetch_steam_appdetails_media_impl(&app_id).await
}

#[tauri::command]
pub async fn get_steam_appdetails_media_batch(
    app_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, SteamAppdetailsMedia>, String> {
    use std::collections::HashSet;

    let mut seen = HashSet::new();
    let valid: Vec<String> = app_ids
        .into_iter()
        .filter_map(|id| {
            let id = id.trim().to_string();
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            if seen.insert(id.clone()) {
                Some(id)
            } else {
                None
            }
        })
        .collect();

    if valid.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let empty = SteamAppdetailsMedia {
        media_urls: Vec::new(),
        video_url: None,
    };

    let stream = futures_util::stream::iter(valid.into_iter().map(|app_id| {
        let fallback = empty.clone();
        async move {
            let result = fetch_steam_appdetails_media_impl(&app_id).await;
            (app_id, result.unwrap_or(fallback))
        }
    }))
    .buffer_unordered(STEAM_CONCURRENCY_LIMIT);

    let results: Vec<(String, SteamAppdetailsMedia)> = stream.collect().await;

    Ok(results.into_iter().collect())
}
