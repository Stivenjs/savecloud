use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use reqwest::Client;
use serde::Deserialize;
use tauri::AppHandle;

use crate::network::{
    head_no_redirect, head_short, post_form_urlencoded, post_json, ProfilePreset,
};

use super::error::{ensure_resolve, map_json_error, HosterError};

const VIKING_REFERER: &str = "https://vikingfile.com/";
const CDN_HOST: &str = "vik1ngfile.site";

pub fn is_vikingfile_url(uri: &str) -> bool {
    let lower = uri.to_lowercase();
    lower.contains("vikingfile.com")
        || lower.contains("vik1ngfile.site")
        || lower.contains("vik1ngfile.")
}

fn extract_file_hash(url: &str) -> Result<String, HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() >= 2 && segments[0].eq_ignore_ascii_case("f") {
        return Ok(segments[1].to_string());
    }
    if let Some(last) = segments.last() {
        if last.len() >= 6 && last.len() <= 32 {
            return Ok(last.to_string());
        }
    }
    Err(HosterError::ResolutionFailed(
        "vikingfile: no se pudo extraer el hash del enlace".into(),
    ))
}

fn is_cloudflare_or_challenge_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("turnstile")
        || lower.contains("challenge")
        || lower.contains("cloudflare")
        || lower.contains("cdn-cgi")
}

#[derive(Deserialize)]
struct CheckFileResponse {
    exist: Option<bool>,
    name: Option<String>,
    size: Option<u64>,
}

#[derive(Deserialize)]
struct GetServerResponse {
    server: Option<String>,
    url: Option<String>,
    name: Option<String>,
}

async fn check_file(client: &Client, hash: &str) -> Result<CheckFileResponse, HosterError> {
    let body = format!(r#"{{"hash":"{hash}"}}"#);
    let response = post_json(
        client,
        "https://vikingfile.com/api/check-file",
        ProfilePreset::VikingfileApi,
        &body,
    )
    .await?;

    let response = ensure_resolve(response)?;
    response
        .json()
        .await
        .map_err(|e| map_json_error(e, "vikingfile"))
}

async fn url_looks_like_binary_download(client: &Client, url: &str) -> bool {
    if is_cloudflare_or_challenge_url(url) {
        return false;
    }

    let preset = ProfilePreset::Downloader {
        referer: VIKING_REFERER.to_string(),
    };

    let Ok(response) = head_short(client, url, preset).await else {
        return false;
    };

    if !response.status().is_success() {
        return false;
    }

    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();

    if content_type.contains("text/html") || content_type.contains("application/json") {
        return false;
    }

    if content_type.contains("octet-stream")
        || content_type.contains("application/zip")
        || content_type.contains("application/x-")
        || content_type.contains("application/vnd")
    {
        return true;
    }

    response.content_length().unwrap_or(0) >= 512 * 1024
}

async fn try_get_server(
    client: &Client,
    hash: &str,
) -> Result<Option<(String, Option<String>)>, HosterError> {
    let form = [("hash", hash)];
    let response = post_form_urlencoded(
        client,
        "https://vikingfile.com/api/get-server",
        ProfilePreset::VikingfileApi,
        &form,
    )
    .await?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let parsed: GetServerResponse = match response.json().await {
        Ok(p) => p,
        Err(e) if e.is_decode() => return Ok(None),
        Err(e) => return Err(map_json_error(e, "vikingfile")),
    };
    let file_name = parsed.name;

    let candidate = if let Some(url) = parsed.url {
        url
    } else if let Some(server) = parsed.server {
        let base = server.trim_end_matches('/');
        format!("{base}/f/{hash}")
    } else {
        return Ok(None);
    };

    if url_looks_like_binary_download(client, &candidate).await {
        return Ok(Some((candidate, file_name)));
    }

    Ok(None)
}

async fn try_cdn_redirect(_client: &Client, hash: &str) -> Result<Option<String>, HosterError> {
    let cdn_url = format!("https://{CDN_HOST}/f/{hash}");
    let response = head_no_redirect(
        &cdn_url,
        ProfilePreset::Downloader {
            referer: VIKING_REFERER.to_string(),
        },
    )
    .await?;

    let status = response.status().as_u16();
    if (300..400).contains(&status) {
        if let Some(loc) = response
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
        {
            let resolved = if loc.starts_with("http") {
                loc.to_string()
            } else {
                reqwest::Url::parse(&cdn_url)
                    .ok()
                    .and_then(|base| base.join(loc).ok())
                    .map(|u| u.to_string())
                    .unwrap_or_else(|| loc.to_string())
            };
            if !is_cloudflare_or_challenge_url(&resolved) {
                return Ok(Some(resolved));
            }
        }
    }
    Ok(None)
}

async fn try_page_redirect(_client: &Client, hash: &str) -> Result<Option<String>, HosterError> {
    let page_url = format!("https://vikingfile.com/f/{hash}");
    let response = head_no_redirect(
        &page_url,
        ProfilePreset::Downloader {
            referer: VIKING_REFERER.to_string(),
        },
    )
    .await?;

    let status = response.status().as_u16();
    if (300..400).contains(&status) {
        if let Some(loc) = response
            .headers()
            .get("location")
            .and_then(|v| v.to_str().ok())
        {
            let resolved = if loc.starts_with("http") {
                loc.to_string()
            } else {
                reqwest::Url::parse(&page_url)
                    .ok()
                    .and_then(|base| base.join(loc).ok())
                    .map(|u| u.to_string())
                    .unwrap_or_else(|| loc.to_string())
            };
            if !is_cloudflare_or_challenge_url(&resolved) {
                return Ok(Some(resolved));
            }
        }
    }
    Ok(None)
}

const VIKING_CAPTCHA_MSG: &str = "vikingfile: Cloudflare/CAPTCHA bloqueó la descarga automática. Abre el enlace en el navegador, completa la verificación y descarga manualmente.";

/// Devuelve URL directa, referer y nombre de archivo opcional.
pub async fn resolve(
    app: Option<&AppHandle>,
    client: &Client,
    url: &str,
    cancel_flag: Option<Arc<AtomicBool>>,
) -> Result<(String, String, Option<String>), HosterError> {
    let hash = extract_file_hash(url)?;
    let mut file_name = None;
    let mut expected_size = None;

    if let Ok(info) = check_file(client, &hash).await {
        if info.exist == Some(false) {
            let detail = info
                .size
                .map(|s| format!(" ({s} bytes esperados)"))
                .unwrap_or_default();
            return Err(HosterError::ResolutionFailed(format!(
                "vikingfile: archivo no encontrado{detail}"
            )));
        }
        file_name = info.name;
        expected_size = info.size;
    }

    if let Some(app) = app {
        log::info!("vikingfile: ejecutando Scrapling crawler para resolver Turnstile y enlace directo");
        if let Ok(scraped) =
            crate::sources::commands::fetch::run_scrapling_fetch(app, url, cancel_flag.clone())
        {
            let trimmed = scraped.trim();
            if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                log::info!("vikingfile: Scrapling resolvió URL directa: {trimmed}");
                return Ok((trimmed.to_string(), VIKING_REFERER.to_string(), file_name));
            }
        }
    }

    // CDN suele devolver la URL firmada real antes que get-server (que a veces apunta a HTML de CF).
    if let Some(dl) = try_cdn_redirect(client, &hash).await? {
        if url_looks_like_binary_download(client, &dl).await {
            return Ok((dl, VIKING_REFERER.to_string(), file_name));
        }
    }

    if let Some(dl) = try_page_redirect(client, &hash).await? {
        if url_looks_like_binary_download(client, &dl).await {
            return Ok((dl, VIKING_REFERER.to_string(), file_name));
        }
    }

    if let Some((dl, name_from_server)) = try_get_server(client, &hash).await? {
        file_name = file_name.or(name_from_server);
        return Ok((dl, VIKING_REFERER.to_string(), file_name));
    }

    let size_note = expected_size
        .map(|s| format!(" (tamaño esperado: {s} bytes)"))
        .unwrap_or_default();
    Err(HosterError::ResolutionFailed(format!(
        "{VIKING_CAPTCHA_MSG}{size_note}"
    )))
}
