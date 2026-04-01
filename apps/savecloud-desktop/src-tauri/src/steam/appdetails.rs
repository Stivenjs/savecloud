//! Cliente a la API pública de la tienda Steam (`/api/appdetails`).
//!
//! Centraliza la lógica compartida entre [`crate::steam::steam_search`] y el catálogo local
//! ([`crate::steam_catalog::enrichment`]).

use std::time::Duration;

use crate::network::STEAM_CLIENT;
use crate::steam_cache::{
    normalize_steam_app_details, normalize_steam_appdetails_media, steam_api_cache,
    SteamAppDetails, SteamAppdetailsMedia,
};

/// Filtros para `appdetails`: `basic` no incluye desarrolladores, géneros, etc.
const STEAM_APPDETAILS_FILTERS_FULL: &str =
    "basic,developers,publishers,genres,categories,release_date,screenshots,movies";
const STEAM_APPDETAILS_FILTERS_WITHOUT_MEDIA: &str =
    "basic,developers,publishers,genres,categories,release_date";

const APPDETAILS_429_MAX_ATTEMPTS: u32 = 5;

/// Realiza una petición a `appdetails` y retorna el campo `data`.
///
/// Retorna `Ok(None)` cuando `success` es `false` (app no encontrada).
pub async fn fetch_appdetails_data(
    app_id: &str,
    lang: &str,
    filters: &str,
) -> Result<Option<serde_json::Value>, String> {
    let url = format!(
        "https://store.steampowered.com/api/appdetails?appids={app_id}&l={lang}&filters={filters}"
    );

    let mut attempt: u32 = 0;
    let body_text = loop {
        let res = STEAM_CLIENT
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("Request Error: {e}"))?;

        let status = res.status();
        let code = status.as_u16();

        if code == 429 {
            eprintln!("Límite de Steam (429) en appdetails, app_id={app_id}, intento {attempt}");
            attempt += 1;
            if attempt >= APPDETAILS_429_MAX_ATTEMPTS {
                return Err(format!("HTTP Error: {status}"));
            }
            let backoff_ms = 500_u64 * 2_u64.pow(attempt.min(5));
            tokio::time::sleep(Duration::from_millis(backoff_ms)).await;
            continue;
        }

        if !status.is_success() {
            return Err(format!("HTTP Error: {status}"));
        }

        break res.text().await.unwrap_or_default();
    };

    if body_text.trim().is_empty() || body_text == "null" {
        return Err("Empty response".into());
    }

    let mut root: serde_json::Value =
        serde_json::from_str(&body_text).map_err(|e| format!("JSON Parse Error: {e}"))?;

    let success = root
        .get(app_id)
        .and_then(|e| e.get("success"))
        .and_then(|e| e.as_bool())
        .unwrap_or(false);

    if !success {
        return Ok(None);
    }

    let data = root
        .as_object_mut()
        .and_then(|obj| obj.remove(app_id))
        .and_then(|mut entry| entry.as_object_mut().and_then(|obj| obj.remove("data")));

    Ok(data)
}

fn extract_best_video_url(movie: &serde_json::Value) -> Option<String> {
    let direct = |key: &str| {
        movie
            .get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(String::from)
    };

    let nested = |container: &str| {
        movie.get(container).and_then(|obj| {
            obj.get("max")
                .or_else(|| obj.get("480"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(String::from)
        })
    };

    direct("hls_h264")
        .or_else(|| direct("dash_h264"))
        .or_else(|| nested("webm"))
        .or_else(|| nested("mp4"))
}

/// Parsea portada, capturas, vídeo, géneros y nombre desde el campo `data` de `appdetails`.
pub fn parse_media_from_data(data: &serde_json::Value) -> SteamAppdetailsMedia {
    let mut media_urls: Vec<String> = Vec::new();
    let mut video_url: Option<String> = None;

    if let Some(header) = data.get("header_image").and_then(|v| v.as_str()) {
        if !header.is_empty() {
            media_urls.push(header.to_owned());
        }
    }

    if let Some(screenshots) = data.get("screenshots").and_then(|v| v.as_array()) {
        for item in screenshots {
            if let Some(path) = item.get("path_full").and_then(|v| v.as_str()) {
                if !path.is_empty() && !media_urls.iter().any(|u| u == path) {
                    media_urls.push(path.to_owned());
                }
            }
        }
    }

    if let Some(movies) = data.get("movies").and_then(|v| v.as_array()) {
        for item in movies {
            if video_url.is_none() {
                video_url = extract_best_video_url(item);
            }
        }
    }

    let name = data
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_owned();

    let genres = extract_keyed_string_array(data, "genres", "description");

    normalize_steam_appdetails_media(SteamAppdetailsMedia {
        media_urls,
        video_url,
        genres,
        name,
    })
}

/// Construye [`SteamAppDetails`] desde el objeto `data` crudo de la Store (`appdetails`),
/// el mismo formato que el worker de steam-seed persiste en `details_json`.
#[must_use]
pub fn steam_app_details_from_store_data(data: &serde_json::Value) -> SteamAppDetails {
    let str_field = |key: &str| -> String {
        data.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned()
    };

    let release_date = data
        .get("release_date")
        .and_then(|rd| rd.get("date").and_then(|v| v.as_str()).map(String::from));

    let pc_req = data.get("pc_requirements");
    let pc_requirements_minimum = pc_req
        .and_then(|r| r.get("minimum"))
        .and_then(|v| v.as_str())
        .map(String::from);
    let pc_requirements_recommended = pc_req
        .and_then(|r| r.get("recommended"))
        .and_then(|v| v.as_str())
        .map(String::from);

    let media = parse_media_from_data(data);

    normalize_steam_app_details(SteamAppDetails {
        name: str_field("name"),
        short_description: str_field("short_description"),
        detailed_description: str_field("detailed_description"),
        header_image: str_field("header_image"),
        developers: extract_plain_string_array(data, "developers"),
        publishers: extract_plain_string_array(data, "publishers"),
        genres: extract_keyed_string_array(data, "genres", "description"),
        categories: extract_keyed_string_array(data, "categories", "description"),
        release_date,
        pc_requirements_minimum,
        pc_requirements_recommended,
        media,
    })
}

fn extract_plain_string_array(value: &serde_json::Value, field: &str) -> Vec<String> {
    value
        .get(field)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn extract_keyed_string_array(value: &serde_json::Value, field: &str, sub: &str) -> Vec<String> {
    value
        .get(field)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.get(sub).and_then(|v| v.as_str()).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// Lista / hover: `basic` (nombre), capturas, tráiler y géneros en una sola petición Store.
pub async fn fetch_steam_appdetails_media_from_store(
    app_id: &str,
) -> Result<SteamAppdetailsMedia, String> {
    let data = fetch_appdetails_data(app_id, "spanish", "basic,screenshots,movies,genres").await?;
    Ok(data
        .as_ref()
        .map(parse_media_from_data)
        .unwrap_or_else(|| SteamAppdetailsMedia {
            media_urls: Vec::new(),
            video_url: None,
            genres: Vec::new(),
            name: String::new(),
        }))
}

/// Ficha completa desde la Store API (español), reutilizando caché de medios en RAM si existe.
pub async fn fetch_steam_app_details_from_store(app_id: &str) -> Result<SteamAppDetails, String> {
    let cached_media = steam_api_cache().get_media(app_id);

    let filters = if cached_media.is_some() {
        STEAM_APPDETAILS_FILTERS_WITHOUT_MEDIA
    } else {
        STEAM_APPDETAILS_FILTERS_FULL
    };

    let data = fetch_appdetails_data(app_id, "spanish", filters)
        .await?
        .ok_or_else(|| "Juego no encontrado en Steam".to_string())?;

    let mut details = steam_app_details_from_store_data(&data);
    if let Some(cached) = cached_media {
        details.media = normalize_steam_appdetails_media(cached);
    } else {
        steam_api_cache().insert_media(app_id.to_owned(), details.media.clone());
    }

    Ok(normalize_steam_app_details(details))
}
