//! FuckingFast `.co` 

use once_cell::sync::Lazy;
use regex::Regex;

use super::constants::HOSTER_DOWNLOADER_USER_AGENT;
use super::error::HosterError;

static FUCKINGFAST_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"window\.open\("(https://fuckingfast\.co/dl/[^"]*)"\)"#)
        .expect("regex fuckingfast")
});

pub fn is_supported_domain(url: &str) -> bool {
    url.to_lowercase().contains("fuckingfast.co")
}

fn map_http_error(status: u16) -> HosterError {
    match status {
        404 => HosterError::ResolutionFailed("archivo no encontrado".into()),
        429 => HosterError::ResolutionFailed(
            "límite de peticiones; inténtalo más tarde".into(),
        ),
        403 => HosterError::ResolutionFailed(
            "acceso denegado (privado o eliminado)".into(),
        ),
        s => HosterError::Http(s),
    }
}

pub async fn resolve(url: &str) -> Result<String, HosterError> {
    if !is_supported_domain(url) {
        return Err(HosterError::ResolutionFailed(
            "fuckingfast: solo fuckingfast.co".into(),
        ));
    }

    let client = reqwest::Client::builder()
        .user_agent(HOSTER_DOWNLOADER_USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HosterError::ResolutionFailed(format!("fuckingfast: cliente: {e}")))?;

    let response = client.get(url).send().await?;
    if !response.status().is_success() {
        return Err(map_http_error(response.status().as_u16()));
    }

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

    let cap = FUCKINGFAST_REGEX
        .captures(&html)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| {
            HosterError::ResolutionFailed(
                "fuckingfast: no se pudo extraer el enlace".into(),
            )
        })?;

    Ok(cap)
}
