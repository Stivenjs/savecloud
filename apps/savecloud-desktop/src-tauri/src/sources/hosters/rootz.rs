//! Rootz.so API 

use serde::Deserialize;

use crate::network::HOSTER_CLIENT;

use super::error::HosterError;

#[derive(Deserialize)]
struct RootzEnvelope {
    success: bool,
    data: Option<RootzData>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct RootzData {
    url: String,
}

pub async fn resolve(url: &str) -> Result<String, HosterError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 || segments[0] != "d" {
        return Err(HosterError::ResolutionFailed(
            "rootz: formato de URL inválido".into(),
        ));
    }
    let id = segments[1];
    let api_url = format!("https://www.rootz.so/api/files/download-by-short/{id}");

    let response = HOSTER_CLIENT.get(api_url).send().await?;

    if response.status() == 404 {
        let msg = response
            .json::<RootzEnvelope>()
            .await
            .ok()
            .and_then(|e| e.error)
            .unwrap_or_else(|| "archivo no encontrado".into());
        return Err(HosterError::ResolutionFailed(msg));
    }

    if !response.status().is_success() {
        return Err(HosterError::Http(response.status().as_u16()));
    }

    let envelope: RootzEnvelope = response.json().await?;
    if envelope.success {
        if let Some(d) = envelope.data {
            return Ok(d.url);
        }
    }

    Err(HosterError::ResolutionFailed(
        envelope
            .error
            .unwrap_or_else(|| "rootz: sin URL de descarga".into()),
    ))
}
