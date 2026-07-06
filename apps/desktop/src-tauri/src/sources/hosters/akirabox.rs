//! AkiraBox: resolución conservadora desde la página pública.

use crate::network::{get, ProfilePreset};
use tauri::AppHandle;

use super::error::{ensure_resolve, HosterError};
use super::html_utils::{extract_download_link, is_url_on_marked_host};

const HOST_MARKERS: &[&str] = &["akirabox.com", "akirabox.to"];
fn normalize_page_url(url: &str) -> Result<String, HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    if parsed.host_str().is_none() {
        return Err(HosterError::InvalidUrl(url.to_string()));
    }
    Ok(parsed.to_string())
}

pub async fn resolve(
    app: Option<&AppHandle>,
    client: &reqwest::Client,
    url: &str,
) -> Result<(String, String), HosterError> {
    let page_url = normalize_page_url(url)?;
    if !is_url_on_marked_host(&page_url, HOST_MARKERS) {
        return Err(HosterError::ResolutionFailed(
            "akirabox: dominio no soportado".into(),
        ));
    }

    if let Some(app) = app {
        let scraped = crate::sources::commands::fetch::run_scrapling_fetch(app, &page_url)
            .map_err(HosterError::ResolutionFailed)?;
        let trimmed = scraped.trim();
        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            return Ok((trimmed.to_string(), page_url));
        }
        if let Some(direct) = extract_download_link(
            trimmed,
            &page_url,
            HOST_MARKERS,
            &["download", "descargar", "télécharger", "telecharger"],
        ) {
            return Ok((direct, page_url));
        }
    }

    let response = get(
        client,
        &page_url,
        ProfilePreset::BrowserSameOrigin {
            referer: page_url.clone(),
        },
    )
    .await?;

    let response = ensure_resolve(response)?;
    let response_url = response.url().to_string();
    if let Some(direct) = extract_download_link(
        response.text().await?.as_str(),
        &response_url,
        HOST_MARKERS,
        &["download", "descargar", "télécharger", "telecharger"],
    ) {
        return Ok((direct, page_url));
    }

    Err(HosterError::ResolutionFailed(
        "akirabox: la página no expuso un enlace de descarga directo".into(),
    ))
}
