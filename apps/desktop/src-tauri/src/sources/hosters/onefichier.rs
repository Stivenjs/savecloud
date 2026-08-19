//! 1fichier: GET de página + POST estándar para revelar el enlace directo.

use crate::network::{get, post_form_urlencoded, ProfilePreset};
use tauri::AppHandle;

use super::error::{ensure_resolve, HosterError};
use super::html_utils::{extract_download_link, has_password_field, is_url_on_marked_host};

const PAGE_HOST_MARKERS: &[&str] = &["1fichier.com"];
const DOWNLOAD_TEXT_MARKERS: &[&str] = &["download", "télécharger", "telecharger"];

fn normalize_page_url(url: &str) -> Result<String, HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    if parsed.host_str().is_none() {
        return Err(HosterError::InvalidUrl(url.to_string()));
    }
    Ok(parsed.to_string())
}

fn has_1fichier_file_id(url: &reqwest::Url) -> bool {
    url.query().map(|q| !q.trim().is_empty()).unwrap_or(false)
}

fn is_direct_1fichier_link(url: &str) -> bool {
    is_url_on_marked_host(url, PAGE_HOST_MARKERS)
}

async fn resolve_native(
    client: &reqwest::Client,
    page_url: &str,
) -> Result<String, HosterError> {
    let response = get(
        client,
        page_url,
        ProfilePreset::BrowserSameOrigin {
            referer: "https://1fichier.com/".to_string(),
        },
    )
    .await?;

    let response = ensure_resolve(response)?;
    let response_url = response.url().to_string();
    if response_url != page_url && is_direct_1fichier_link(&response_url) {
        return Ok(response_url);
    }
    let page_html = response.text().await?;

    if has_password_field(&page_html) {
        return Err(HosterError::ResolutionFailed(
            "1fichier: el enlace requiere contraseña; ábrelo en el navegador e introdúcela manualmente.".into(),
        ));
    }

    let post_response = post_form_urlencoded(
        client,
        page_url,
        ProfilePreset::BrowserSameOrigin {
            referer: page_url.to_string(),
        },
        &[("dl_no_ssl", "on"), ("dlinline", "on")],
    )
    .await?;

    let post_response = ensure_resolve(post_response)?;
    let post_response_url = post_response.url().to_string();
    if post_response_url != page_url && is_direct_1fichier_link(&post_response_url) {
        return Ok(post_response_url);
    }

    let post_html = post_response.text().await?;
    if let Some(direct) = extract_download_link(
        &post_html,
        &post_response_url,
        PAGE_HOST_MARKERS,
        DOWNLOAD_TEXT_MARKERS,
    ) {
        if is_direct_1fichier_link(&direct)
            || direct.contains("/dl/")
            || direct.contains("download")
        {
            return Ok(direct);
        }
    }

    if let Some(direct) = extract_download_link(
        &page_html,
        page_url,
        PAGE_HOST_MARKERS,
        DOWNLOAD_TEXT_MARKERS,
    ) {
        if is_direct_1fichier_link(&direct)
            || direct.contains("/dl/")
            || direct.contains("download")
        {
            return Ok(direct);
        }
    }

    Err(HosterError::ResolutionFailed(
        "1fichier: no se pudo extraer el enlace directo de la página".into(),
    ))
}

pub async fn resolve(
    app: Option<&AppHandle>,
    client: &reqwest::Client,
    url: &str,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<(String, String), HosterError> {
    let page_url = normalize_page_url(url)?;
    let parsed =
        reqwest::Url::parse(&page_url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    if !has_1fichier_file_id(&parsed) {
        return Err(HosterError::ResolutionFailed(
            "1fichier: la URL no parece contener un identificador de archivo".into(),
        ));
    }

    // 1. Intento nativo rápido
    match resolve_native(client, &page_url).await {
        Ok(direct) => Ok((direct, page_url)),
        Err(native_err) => {
            if let Some(app) = app {
                log::info!("1fichier: intento nativo falló ({native_err:?}), intentando Scrapling fallback");
                if let Ok(scraped) = crate::sources::commands::fetch::run_scrapling_fetch(app, &page_url, cancel_flag) {
                    let trimmed = scraped.trim();
                    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                        return Ok((trimmed.to_string(), page_url));
                    }
                    if let Some(direct) =
                        extract_download_link(trimmed, &page_url, PAGE_HOST_MARKERS, DOWNLOAD_TEXT_MARKERS)
                    {
                        if is_direct_1fichier_link(&direct)
                            || direct.contains("/dl/")
                            || direct.contains("download")
                        {
                            return Ok((direct, page_url));
                        }
                    }
                }
            }
            Err(native_err)
        }
    }
}
