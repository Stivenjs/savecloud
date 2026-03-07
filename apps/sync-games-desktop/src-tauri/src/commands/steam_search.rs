//! Búsqueda dinámica de Steam App ID por nombre y resolución de App ID a nombre.

use futures_util::FutureExt;
use regex::{Regex, RegexBuilder};
use std::sync::OnceLock;

static APP_ID_REGEX: OnceLock<Regex> = OnceLock::new();
static SUGGEST_REGEX: OnceLock<Regex> = OnceLock::new();

/// Obtiene el nombre del juego a partir del Steam App ID (API appdetails).
/// Reintenta hasta 3 veces ante fallos transitorios (red, rate limit).
#[tauri::command]
pub async fn get_steam_app_name(app_id: String) -> Option<String> {
    let app_id = app_id.trim().to_string();
    if app_id.is_empty() || !app_id.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    const MAX_RETRIES: u32 = 3;
    const RETRY_DELAY_MS: u64 = 800;

    for attempt in 0..MAX_RETRIES {
        if attempt > 0 {
            std::thread::sleep(std::time::Duration::from_millis(
                RETRY_DELAY_MS * attempt as u64,
            ));
        }

        if let Some(name) = fetch_steam_app_name_impl(&app_id).await {
            return Some(name);
        }
    }
    None
}

async fn fetch_steam_app_name_impl(app_id: &str) -> Option<String> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={}",
        app_id
    );

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .ok()?;

    let res = client.get(&url).send().await.ok()?;
    let data: serde_json::Value = res.json().await.ok()?;
    let entry = data.get(app_id)?;
    let success = entry.get("success")?.as_bool()?;
    if !success {
        return None;
    }
    entry.get("data")?.get("name")?.as_str().map(String::from)
}

/// Lógica interna: busca Steam App ID por texto de búsqueda (una petición HTTP).
async fn search_steam_app_id_impl(query: String) -> Option<String> {
    let term = query.replace('-', " ");
    let url = format!(
        "https://store.steampowered.com/search/suggest?term={}&f=games&cc=US&l=english",
        urlencoding::encode(&term)
    );

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .ok()?;

    let body = client.get(&url).send().await.ok()?.text().await.ok()?;

    let re = APP_ID_REGEX.get_or_init(|| Regex::new(r#"/app/(\d{4,10})/"#).expect("regex válida"));

    re.captures_iter(&body)
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

/// Busca Steam App IDs para varias consultas en paralelo (una sola operación batch).
/// Devuelve un resultado por cada query, en el mismo orden (query vacía → None).
#[tauri::command]
pub async fn search_steam_app_ids_batch(queries: Vec<String>) -> Vec<Option<String>> {
    if queries.is_empty() {
        return Vec::new();
    }
    let trimmed: Vec<String> = queries.into_iter().map(|q| q.trim().to_string()).collect();
    let futures: Vec<_> = trimmed
        .into_iter()
        .map(|q| {
            async move {
                if q.is_empty() {
                    None
                } else {
                    search_steam_app_id_impl(q).await
                }
            }
            .boxed()
        })
        .collect();
    futures_util::future::join_all(futures).await
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

    let client = match reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return Vec::new();
        }
    };

    let body = match client.get(&url).send().await {
        Ok(resp) => match resp.text().await {
            Ok(text) => text,
            Err(_) => return Vec::new(),
        },
        Err(_) => {
            return Vec::new();
        }
    };

    let re = SUGGEST_REGEX.get_or_init(|| {
        // Captura cada bloque <a ... data-ds-appid="ID"...> ... </a>
        // y dejamos el nombre para un segundo regex dentro del bloque.
        RegexBuilder::new(r#"<a[^>]+data-ds-appid="(\d{4,10})"[^>]*>(.*?)</a>"#)
            .dot_matches_new_line(true)
            .build()
            .expect("regex válida para sugerencias de Steam")
    });

    let mut results = Vec::new();
    // El HTML de Steam puede tener clases adicionales en el span/div de nombre,
    // así que buscamos cualquier tag con class que contenga "match_name".
    let name_re =
        Regex::new(r#"class="[^"]*match_name[^"]*"[^>]*>([^<]+)<"#).expect("regex nombre Steam");
    for cap in re.captures_iter(&body) {
        let app_id = match cap.get(1) {
            Some(m) => m.as_str().to_string(),
            None => continue,
        };
        let inner = cap.get(2).map(|m| m.as_str()).unwrap_or("");
        let name = match name_re.captures(inner) {
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
