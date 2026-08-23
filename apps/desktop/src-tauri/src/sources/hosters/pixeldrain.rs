//! Pixeldrain: bypass CDN opcional + API

use crate::network::{head_short, ProfilePreset};

use super::error::HosterError;

const BYPASS_BASE: &str = "https://cdn.pixeldrain.eu.cc";

fn extract_id(url: &reqwest::Url) -> Result<String, HosterError> {
    let parts: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 || parts[0] != "u" {
        return Err(HosterError::ResolutionFailed(
            "pixeldrain: URL inválida (se espera /u/{id})".into(),
        ));
    }
    Ok(parts[1].to_string())
}

async fn try_bypass(client: &reqwest::Client, id: &str) -> Option<String> {
    let bypass_url = format!("{BYPASS_BASE}/{id}");
    let response = head_short(client, &bypass_url, ProfilePreset::PixeldrainBypass)
        .await
        .ok()?;
    let status = response.status();
    if status.is_success() || (status.as_u16() >= 200 && status.as_u16() < 400) {
        Some(bypass_url)
    } else {
        None
    }
}

async fn check_availability(client: &reqwest::Client, id: &str) -> Result<(), HosterError> {
    let check = format!("https://pixeldrain.com/u/{id}");
    let response = head_short(
        client,
        &check,
        ProfilePreset::PixeldrainCheck {
            page_url: check.clone(),
        },
    )
    .await?;
    if response.status() == 404 {
        return Err(HosterError::ResolutionFailed(
            "pixeldrain: archivo no encontrado".into(),
        ));
    }
    Ok(())
}

pub async fn resolve(client: &reqwest::Client, url: &str) -> Result<(String, String), HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let id = extract_id(&parsed)?;
    let page_referer = format!("https://pixeldrain.com/u/{id}");

    if let Some(u) = try_bypass(client, &id).await {
        return Ok((u, page_referer));
    }

    check_availability(client, &id).await?;
    Ok((
        format!("https://pixeldrain.com/api/file/{id}?download"),
        page_referer,
    ))
}
