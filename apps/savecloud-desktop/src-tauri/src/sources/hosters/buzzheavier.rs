//! Buzzheavier / dominios relacionados 

use reqwest::redirect::Policy;

use super::constants::HOSTER_DOWNLOADER_USER_AGENT;
use super::error::HosterError;

const DOMAINS: &[&str] = &["buzzheavier.com", "bzzhr.co", "fuckingfast.net"];

pub fn is_supported_domain(url: &str) -> bool {
    let lower = url.to_lowercase();
    DOMAINS.iter().any(|d| lower.contains(d))
}

fn buzzheavier_client_no_redirect() -> Result<reqwest::Client, HosterError> {
    reqwest::Client::builder()
        .user_agent(HOSTER_DOWNLOADER_USER_AGENT)
        .redirect(Policy::none())
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HosterError::ResolutionFailed(format!("buzzheavier: cliente: {e}")))
}

pub async fn resolve(url: &str) -> Result<String, HosterError> {
    if !is_supported_domain(url) {
        return Err(HosterError::ResolutionFailed(
            "buzzheavier: dominio no soportado".into(),
        ));
    }

    let base_url = url.split('#').next().unwrap_or(url).to_string();

    let get_client = reqwest::Client::builder()
        .user_agent(HOSTER_DOWNLOADER_USER_AGENT)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| HosterError::ResolutionFailed(format!("buzzheavier: cliente: {e}")))?;

    get_client.get(&base_url).send().await?;

    let download_url = format!("{}/download", base_url.trim_end_matches('/'));
    let head_client = buzzheavier_client_no_redirect()?;

    let head_response = head_client
        .head(&download_url)
        .header("hx-current-url", &base_url)
        .header("hx-request", "true")
        .header("referer", &base_url)
        .send()
        .await?;

    let status = head_response.status();
    if !(status.is_success() || status == 204 || status == 301 || status == 302) {
        return Err(HosterError::Http(status.as_u16()));
    }

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

    Ok(direct)
}
