//! Pixeldrain: comprobación de disponibilidad por API y descarga directa.

use serde::Deserialize;

use crate::network::{get, ProfilePreset};

use super::error::HosterError;

#[derive(Debug, Deserialize)]
struct PixeldrainInfoResponse {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    message: Option<String>,
    #[serde(default)]
    availability: Option<String>,
    #[serde(default)]
    availability_message: Option<String>,
    #[serde(default)]
    can_download: Option<bool>,
}

fn extract_id(url: &reqwest::Url) -> Result<String, HosterError> {
    let parts: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() < 2 || parts[0] != "u" {
        return Err(HosterError::ResolutionFailed(
            "pixeldrain: URL inválida (se espera /u/{id})".into(),
        ));
    }
    Ok(parts[1].to_string())
}

async fn check_availability(client: &reqwest::Client, id: &str) -> Result<(), HosterError> {
    let info_url = format!("https://pixeldrain.com/api/file/{id}/info");
    let page_url = format!("https://pixeldrain.com/u/{id}");

    let response = get(
        client,
        &info_url,
        ProfilePreset::PixeldrainCheck {
            page_url: page_url.clone(),
        },
    )
    .await?;

    if response.status() == 404 {
        return Err(HosterError::ResolutionFailed(
            "pixeldrain: archivo no encontrado o eliminado".into(),
        ));
    }

    if !response.status().is_success() {
        return Err(HosterError::ResolutionFailed(format!(
            "pixeldrain: el servidor respondió con HTTP {}",
            response.status().as_u16()
        )));
    }

    let info: PixeldrainInfoResponse = response
        .json()
        .await
        .map_err(|e| HosterError::ResolutionFailed(format!("pixeldrain: respuesta inválida: {e}")))?;

    if !info.success && info.value.as_deref() == Some("not_found") {
        return Err(HosterError::ResolutionFailed(
            "pixeldrain: archivo no encontrado".into(),
        ));
    }

    let availability = info.availability.as_deref().unwrap_or("");
    if availability.contains("captcha_required") {
        let reason = info.availability_message.unwrap_or_else(|| {
            "Límite de ancho de banda alcanzado en este archivo".into()
        });
        return Err(HosterError::ResolutionFailed(format!(
            "pixeldrain: requiere reCAPTCHA manual de Google ({reason}). Usa un hoster alternativo (DataNodes o FileKeeper) o descarga manualmente desde el navegador."
        )));
    }

    if info.can_download == Some(false) {
        let msg = info.message.unwrap_or_else(|| "Descarga no permitida".into());
        return Err(HosterError::ResolutionFailed(format!(
            "pixeldrain: no se puede descargar ({msg})"
        )));
    }

    Ok(())
}

pub async fn resolve(client: &reqwest::Client, url: &str) -> Result<(String, String), HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let id = extract_id(&parsed)?;
    let page_referer = format!("https://pixeldrain.com/u/{id}");

    check_availability(client, &id).await?;

    Ok((
        format!("https://pixeldrain.com/api/file/{id}?download"),
        page_referer,
    ))
}
