//! Buzzheavier / dominios relacionados

use crate::network::{get, ProfilePreset};
use tauri::AppHandle;

use super::error::{ensure_resolve, HosterError};

const DOMAINS: &[&str] = &["buzzheavier.com", "bzzhr.co", "fuckingfast.net"];

pub fn is_supported_domain(url: &str) -> bool {
    let lower = url.to_lowercase();
    DOMAINS.iter().any(|d| lower.contains(d))
}

pub async fn resolve(
    app: Option<&AppHandle>,
    client: &reqwest::Client,
    url: &str,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<(String, String), HosterError> {
    if !is_supported_domain(url) {
        return Err(HosterError::ResolutionFailed(
            "buzzheavier: dominio no soportado".into(),
        ));
    }

    let base_url = url.split('#').next().unwrap_or(url).to_string();

    if let Some(app) = app {
        if let Ok(scraped) = crate::sources::commands::fetch::run_scrapling_fetch(app, &base_url, cancel_flag) {
            let trimmed = scraped.trim();
            if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                return Ok((trimmed.to_string(), base_url));
            }
        }
    }

    let response = get(client, &base_url, ProfilePreset::BuzzheavierPage).await?;
    ensure_resolve(response)?;

    let download_url = format!("{}/download", base_url.trim_end_matches('/'));

    let head_response = get(
        client,
        &download_url,
        ProfilePreset::BuzzheavierHead {
            page_url: base_url.clone(),
        },
    )
    .await?;

    let head_response = ensure_resolve(head_response)?;

    let hx_redirect = head_response
        .headers()
        .get("hx-redirect")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            HosterError::ResolutionFailed(
                "buzzheavier: sin cabecera hx-redirect (¿borrado o carpeta?)".into(),
            )
        })?;

    let domain = reqwest::Url::parse(&base_url)
        .map_err(|_| HosterError::InvalidUrl(base_url.clone()))?
        .host_str()
        .unwrap_or("buzzheavier.com")
        .to_string();

    let direct = if hx_redirect.starts_with("/dl/") {
        format!("https://{domain}{hx_redirect}")
    } else {
        hx_redirect.to_string()
    };

    Ok((direct, base_url))
}
