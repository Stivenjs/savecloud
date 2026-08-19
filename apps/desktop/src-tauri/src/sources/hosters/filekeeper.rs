//! FileKeeper: resolución conservadora desde la página pública.

use std::sync::LazyLock;
use std::time::Duration;

use crate::network::{get, ProfilePreset};
use scraper::{Html, Selector};
use tauri::AppHandle;
use tokio::time::sleep;

use super::error::{ensure_resolve, HosterError};
use super::html_utils::{extract_download_link, is_url_on_marked_host};

static DOWNLOAD_FORM_SELECTOR: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse(r#"form[action]"#).expect("selector filekeeper form[action]"));
static FORM_INPUT_SELECTOR: LazyLock<Selector> =
    LazyLock::new(|| Selector::parse("input[name]").expect("selector filekeeper input[name]"));

const HOST_MARKERS: &[&str] = &["filekeeper.net"];
const TEXT_MARKERS: &[&str] = &["download", "descargar", "download file", "free download"];
const DOWNLOAD_WAIT: Duration = Duration::from_secs(5);

fn normalize_page_url(url: &str) -> Result<String, HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    if parsed.host_str().is_none() {
        return Err(HosterError::InvalidUrl(url.to_string()));
    }
    Ok(parsed.to_string())
}

fn extract_download_form(
    page_html: &str,
    page_url: &str,
) -> Option<(String, Vec<(String, String)>)> {
    let page = reqwest::Url::parse(page_url).ok()?;
    let document = Html::parse_document(page_html);

    for form in document.select(&DOWNLOAD_FORM_SELECTOR) {
        let action = form.value().attr("action")?;
        let resolved_action = page.join(action).ok()?;
        if !is_url_on_marked_host(resolved_action.as_str(), HOST_MARKERS)
            || !resolved_action.path().contains("download")
        {
            continue;
        }

        let mut fields = Vec::new();
        for input in form.select(&FORM_INPUT_SELECTOR) {
            let value = input.value();
            let Some(name) = value.attr("name") else {
                continue;
            };
            fields.push((
                name.to_string(),
                value.attr("value").unwrap_or("").to_string(),
            ));
        }

        if !fields.is_empty() {
            return Some((resolved_action.to_string(), fields));
        }
    }

    None
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
    let page_html = response.text().await?;

    if let Some(direct) = extract_download_link(&page_html, page_url, HOST_MARKERS, TEXT_MARKERS) {
        return Ok(direct);
    }

    sleep(DOWNLOAD_WAIT).await;

    let Some((download_url, form_fields)) = extract_download_form(&page_html, page_url) else {
        return Err(HosterError::ResolutionFailed(
            "filekeeper: no se encontró el formulario de descarga".into(),
        ));
    };

    let form_fields_ref: Vec<(&str, &str)> = form_fields
        .iter()
        .map(|(name, value)| (name.as_str(), value.as_str()))
        .collect();

    let download_response = crate::network::post_form_urlencoded(
        client,
        &download_url,
        ProfilePreset::BrowserSameOrigin {
            referer: page_url.to_string(),
        },
        &form_fields_ref,
    )
    .await?;

    let download_response = ensure_resolve(download_response)?;
    let direct_url = download_response.url().to_string();
    if !is_url_on_marked_host(&direct_url, HOST_MARKERS) {
        return Ok(direct_url);
    }

    let download_html = download_response.text().await?;
    if let Some(direct) =
        extract_download_link(&download_html, &download_url, HOST_MARKERS, TEXT_MARKERS)
    {
        return Ok(direct);
    }

    Err(HosterError::ResolutionFailed(
        "filekeeper: el formulario no devolvió un enlace de descarga directo".into(),
    ))
}

pub async fn resolve(
    app: Option<&AppHandle>,
    client: &reqwest::Client,
    url: &str,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<(String, String), HosterError> {
    let page_url = normalize_page_url(url)?;
    if !is_url_on_marked_host(&page_url, HOST_MARKERS) {
        return Err(HosterError::ResolutionFailed(
            "filekeeper: dominio no soportado".into(),
        ));
    }

    // 1. Intento nativo rápido
    match resolve_native(client, &page_url).await {
        Ok(direct) => Ok((direct, page_url)),
        Err(native_err) => {
            if let Some(app) = app {
                log::info!("filekeeper: intento nativo falló ({native_err:?}), intentando Scrapling fallback");
                if let Ok(scraped) = crate::sources::commands::fetch::run_scrapling_fetch(app, &page_url, cancel_flag) {
                    let trimmed = scraped.trim();
                    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                        return Ok((trimmed.to_string(), page_url));
                    }
                    if let Some(direct) = extract_download_link(trimmed, &page_url, HOST_MARKERS, TEXT_MARKERS) {
                        return Ok((direct, page_url));
                    }
                }
            }
            Err(native_err)
        }
    }
}
