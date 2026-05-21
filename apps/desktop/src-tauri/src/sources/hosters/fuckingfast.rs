//! FuckingFast `.co`

use once_cell::sync::Lazy;
use regex::Regex;

use crate::network::{get, ProfilePreset};

use super::error::{ensure_resolve, HosterError};

static FUCKINGFAST_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"window\.open\("(https://fuckingfast\.co/dl/[^"]*)"\)"#)
        .expect("regex fuckingfast")
});

pub fn is_supported_domain(url: &str) -> bool {
    url.to_lowercase().contains("fuckingfast.co")
}

pub async fn resolve(client: &reqwest::Client, url: &str) -> Result<(String, String), HosterError> {
    if !is_supported_domain(url) {
        return Err(HosterError::ResolutionFailed(
            "fuckingfast: solo fuckingfast.co".into(),
        ));
    }

    let page_url = url.to_string();
    let response = get(
        client,
        &page_url,
        ProfilePreset::Downloader {
            referer: page_url.clone(),
        },
    )
    .await?;

    let response = ensure_resolve(response)?;
    let html = response.text().await?;
    let lower = html.to_lowercase();
    if lower.contains("rate limit") {
        return Err(HosterError::ResolutionFailed(
            "límite de peticiones; espera unos minutos".into(),
        ));
    }
    if html.contains("File Not Found Or Deleted") {
        return Err(HosterError::ResolutionFailed(
            "archivo no encontrado o eliminado".into(),
        ));
    }

    let direct = FUCKINGFAST_REGEX
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| {
            HosterError::ResolutionFailed(
                "fuckingfast: no se pudo extraer el enlace".into(),
            )
        })?;

    Ok((direct, page_url))
}
