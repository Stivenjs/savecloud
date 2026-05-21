//! Buzzheavier / dominios relacionados

use crate::network::{get, head_no_redirect, ProfilePreset};

use super::error::{ensure_resolve, HosterError};

const DOMAINS: &[&str] = &["buzzheavier.com", "bzzhr.co", "fuckingfast.net"];

pub fn is_supported_domain(url: &str) -> bool {
    let lower = url.to_lowercase();
    DOMAINS.iter().any(|d| lower.contains(d))
}

pub async fn resolve(client: &reqwest::Client, url: &str) -> Result<(String, String), HosterError> {
    if !is_supported_domain(url) {
        return Err(HosterError::ResolutionFailed(
            "buzzheavier: dominio no soportado".into(),
        ));
    }

    let base_url = url.split('#').next().unwrap_or(url).to_string();

    let response = get(client, &base_url, ProfilePreset::BuzzheavierPage).await?;
    ensure_resolve(response)?;

    let download_url = format!("{}/download", base_url.trim_end_matches('/'));

    let head_response = head_no_redirect(
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
