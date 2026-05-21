//! Rootz.so API

use serde::Deserialize;

use crate::network::{get, ProfilePreset};

use super::error::{ensure_resolve, HosterError};

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

pub async fn resolve(client: &reqwest::Client, url: &str) -> Result<(String, String), HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 || segments[0] != "d" {
        return Err(HosterError::ResolutionFailed(
            "rootz: formato de URL inválido".into(),
        ));
    }
    let id = segments[1];
    let api_url = format!("https://www.rootz.so/api/files/download-by-short/{id}");
    let referer = format!("https://www.rootz.so/d/{id}");

    let response = get(client, &api_url, ProfilePreset::RootzApi).await?;

    if response.status() == 404 {
        let msg = response
            .json::<RootzEnvelope>()
            .await
            .ok()
            .and_then(|e| e.error)
            .unwrap_or_else(|| "archivo no encontrado".into());
        return Err(HosterError::ResolutionFailed(msg));
    }

    let response = ensure_resolve(response)?;
    let envelope: RootzEnvelope = response.json().await?;
    if envelope.success {
        if let Some(d) = envelope.data {
            return Ok((d.url, referer));
        }
    }

    Err(HosterError::ResolutionFailed(
        envelope
            .error
            .unwrap_or_else(|| "rootz: sin URL de descarga".into()),
    ))
}
