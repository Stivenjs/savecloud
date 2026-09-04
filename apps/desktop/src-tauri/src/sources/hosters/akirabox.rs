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

async fn resolve_native(
    client: &reqwest::Client,
    page_url: &str,
) -> Result<String, HosterError> {
    let response = get(
        client,
        page_url,
        ProfilePreset::BrowserSameOrigin {
            referer: page_url.to_string(),
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
        return Ok(direct);
    }

    Err(HosterError::ResolutionFailed(
        "akirabox: la página no expuso un enlace de descarga directo".into(),
    ))
}

pub async fn resolve(
    app: Option<&AppHandle>,
    client: &reqwest::Client,
    url: &str,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    on_event: Option<crate::sources::commands::fetch::CrawlerEventCallback>,
) -> Result<(String, String), HosterError> {
    let page_url = normalize_page_url(url)?;
    if !is_url_on_marked_host(&page_url, HOST_MARKERS) {
        return Err(HosterError::ResolutionFailed(
            "akirabox: dominio no soportado".into(),
        ));
    }

    // 1. Intento nativo rápido
    match resolve_native(client, &page_url).await {
        Ok(direct) => Ok((direct, page_url)),
        Err(native_err) => {
            if let Some(app) = app {
                log::info!("akirabox: intento nativo falló ({native_err:?}), intentando Scrapling fallback");
                if let Ok(scraped) = crate::sources::commands::fetch::run_scrapling_fetch_with_progress(
                    app,
                    &page_url,
                    cancel_flag,
                    on_event,
                ) {
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
            }
            Err(native_err)
        }
    }
}
