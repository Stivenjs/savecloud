//! Rootz.so: pageToken + proxy-download → URL firmada R2 (como el navegador).

use std::sync::LazyLock;
use std::time::Duration;

use regex::Regex;
use serde::Deserialize;
use tokio::time::sleep;

use crate::network::{get, head_with_client, ProfilePreset};

use super::error::{ensure_resolve, HosterError};

const ROOTZ_ORIGIN: &str = "https://rootz.so";
const PROXY_RETRY_ATTEMPTS: u32 = 3;
const PROXY_RETRY_DELAY: Duration = Duration::from_millis(900);

static PAGE_TOKEN_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"pageToken\\":\\"([^\\"]+)\\"|pageToken":"([^"]+)""#)
        .expect("regex rootz pageToken")
});

#[derive(Deserialize)]
struct RootzEnvelope {
    success: bool,
    data: Option<RootzData>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct RootzData {
    url: Option<String>,
    #[serde(rename = "fileId")]
    file_id: Option<String>,
    #[serde(rename = "fileName")]
    file_name: Option<String>,
    #[serde(rename = "downloadAllowed")]
    download_allowed: Option<bool>,
    #[serde(rename = "passwordProtected")]
    password_protected: Option<bool>,
    status: Option<String>,
    #[serde(rename = "remainingDownloads")]
    remaining_downloads: Option<i64>,
}

fn file_hint(data: &RootzData) -> String {
    data.file_name
        .as_deref()
        .map(|n| format!(" ({n})"))
        .unwrap_or_default()
}

fn extract_short_id(url: &str) -> Result<String, HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 || segments[0] != "d" {
        return Err(HosterError::ResolutionFailed(
            "rootz: formato de URL inválido (se espera /d/{id})".into(),
        ));
    }
    Ok(segments[1].to_string())
}

fn extract_page_token(html: &str) -> Result<String, HosterError> {
    PAGE_TOKEN_RE
        .captures(html)
        .and_then(|c| c.get(1).or_else(|| c.get(2)))
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| {
            HosterError::ResolutionFailed(
                "rootz: no se encontró pageToken en la página (¿enlace caducado o bloqueado?)"
                    .into(),
            )
        })
}

fn location_from_redirect(response: &reqwest::Response, base_url: &str) -> Option<String> {
    let status = response.status().as_u16();
    if !(300..400).contains(&status) {
        return None;
    }
    let loc = response
        .headers()
        .get("location")
        .and_then(|v| v.to_str().ok())?;
    Some(if loc.starts_with("http") {
        loc.to_string()
    } else {
        reqwest::Url::parse(base_url)
            .ok()
            .and_then(|base| base.join(loc).ok())
            .map(|u| u.to_string())
            .unwrap_or_else(|| loc.to_string())
    })
}

fn is_signed_cdn_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("cloudflarestorage.com") || lower.contains("alcyone.so")
}

fn is_truly_deleted(data: &RootzData) -> bool {
    data.status.as_deref() == Some("deleted") && data.file_id.is_none()
}

fn metadata_denied_message(data: &RootzData) -> String {
    let hint = file_hint(data);
    if data.password_protected == Some(true) {
        return format!(
            "rootz: el archivo requiere contraseña{hint}; ábrelo en el navegador y descárgalo manualmente."
        );
    }
    if is_truly_deleted(data) {
        return format!("rootz: el archivo fue eliminado{hint}.");
    }
    if data.remaining_downloads == Some(0) {
        return format!("rootz: se agotaron las descargas permitidas para este enlace{hint}.");
    }
    if data.file_id.is_some() {
        return format!(
            "rootz: no se pudo resolver la descarga{hint}. Abre el enlace en el navegador, espera unos segundos y pulsa descargar de nuevo."
        );
    }
    if data.download_allowed == Some(false) {
        return format!(
            "rootz: el hoster no permite descarga automática de este archivo{hint} (límite o restricción del dueño)."
        );
    }
    format!("rootz: no se pudo obtener la URL de descarga{hint}.")
}

async fn fetch_page_token(client: &reqwest::Client, page_url: &str) -> Result<String, HosterError> {
    let response = get(
        client,
        page_url,
        ProfilePreset::BrowserSameOrigin {
            referer: format!("{ROOTZ_ORIGIN}/"),
        },
    )
    .await?;
    let response = ensure_resolve(response)?;
    let html = response.text().await?;
    extract_page_token(&html)
}

async fn rootz_api_get(
    client: &reqwest::Client,
    api_url: &str,
    page_token: &str,
    referer: &str,
) -> Result<RootzEnvelope, HosterError> {
    let response = get(
        client,
        api_url,
        ProfilePreset::RootzApi {
            page_token: page_token.to_string(),
            referer: referer.to_string(),
        },
    )
    .await?;
    let response = ensure_resolve(response)?;
    response
        .json()
        .await
        .map_err(|e| super::error::map_json_error(e, "rootz"))
}

fn envelope_data(envelope: RootzEnvelope) -> Result<RootzData, HosterError> {
    if envelope.success {
        if let Some(data) = envelope.data {
            return Ok(data);
        }
    }
    Err(HosterError::ResolutionFailed(
        envelope
            .error
            .unwrap_or_else(|| "rootz: respuesta sin datos".into()),
    ))
}

async fn fetch_metadata(
    client: &reqwest::Client,
    short_id: &str,
    page_token: &str,
    referer: &str,
) -> Result<RootzData, HosterError> {
    let api_url = format!("{ROOTZ_ORIGIN}/api/files/download-by-short/{short_id}");
    envelope_data(rootz_api_get(client, &api_url, page_token, referer).await?)
}

fn rootz_api_preset(page_token: &str, referer: &str) -> ProfilePreset {
    ProfilePreset::RootzApi {
        page_token: page_token.to_string(),
        referer: referer.to_string(),
    }
}

/// `proxy-download` como el navegador: cookies de sesión + HEAD siguiendo redirecciones al CDN.
async fn try_proxy_cdn_url(
    client: &reqwest::Client,
    proxy_id: &str,
    page_token: &str,
    referer: &str,
) -> Result<String, HosterError> {
    let proxy_url = format!("{ROOTZ_ORIGIN}/api/files/proxy-download/{proxy_id}");

    let browser_preset = ProfilePreset::BrowserSameOrigin {
        referer: referer.to_string(),
    };
    if let Ok(response) = head_with_client(client, &proxy_url, browser_preset).await {
        if let Ok(response) = ensure_resolve(response) {
            let final_url = response.url().to_string();
            if is_signed_cdn_url(&final_url) {
                return Ok(final_url);
            }
            if let Some(loc) = location_from_redirect(&response, &proxy_url) {
                return Ok(loc);
            }
        }
    }

    let response =
        head_with_client(client, &proxy_url, rootz_api_preset(page_token, referer)).await?;
    let response = ensure_resolve(response)?;
    let final_url = response.url().to_string();
    if is_signed_cdn_url(&final_url) {
        return Ok(final_url);
    }

    location_from_redirect(&response, &proxy_url).ok_or_else(|| {
        HosterError::ResolutionFailed("rootz: proxy-download no devolvió redirección al CDN".into())
    })
}

async fn resolve_proxy_cdn_url(
    client: &reqwest::Client,
    short_id: &str,
    file_id: Option<&str>,
    page_token: &str,
    referer: &str,
) -> Result<String, HosterError> {
    let mut last_err: Option<HosterError> = None;

    for attempt in 0..PROXY_RETRY_ATTEMPTS {
        if attempt > 0 {
            sleep(PROXY_RETRY_DELAY).await;
        }

        match try_proxy_cdn_url(client, short_id, page_token, referer).await {
            Ok(url) => return Ok(url),
            Err(e) => last_err = Some(e),
        }

        if let Some(fid) = file_id {
            if fid != short_id {
                match try_proxy_cdn_url(client, fid, page_token, referer).await {
                    Ok(url) => return Ok(url),
                    Err(e) => last_err = Some(e),
                }
            }
        }
    }

    Err(last_err.unwrap_or_else(|| {
        HosterError::ResolutionFailed("rootz: proxy-download falló tras reintentos".into())
    }))
}

async fn resolve_via_file_id_api(
    client: &reqwest::Client,
    file_id: &str,
    page_token: &str,
    referer: &str,
) -> Result<String, HosterError> {
    let download_api = format!("{ROOTZ_ORIGIN}/api/files/download/{file_id}");
    let data = envelope_data(rootz_api_get(client, &download_api, page_token, referer).await?)?;
    data.url.filter(|u| !u.is_empty()).ok_or_else(|| {
        HosterError::ResolutionFailed("rootz: la API no devolvió URL de descarga".into())
    })
}

async fn resolve_direct_url(
    client: &reqwest::Client,
    short_id: &str,
    page_token: &str,
    referer: &str,
) -> Result<(String, Option<String>), HosterError> {
    let meta = fetch_metadata(client, short_id, page_token, referer).await?;

    if meta.password_protected == Some(true) {
        return Err(HosterError::ResolutionFailed(metadata_denied_message(
            &meta,
        )));
    }

    let file_id_ref = meta.file_id.as_deref();

    if let Ok(cdn) = resolve_proxy_cdn_url(client, short_id, file_id_ref, page_token, referer).await
    {
        return Ok((cdn, meta.file_name));
    }

    if let Some(url) = meta.url.as_ref().filter(|u| !u.is_empty()) {
        return Ok((url.clone(), meta.file_name));
    }

    if let Some(ref file_id) = meta.file_id {
        if let Ok(url) = resolve_via_file_id_api(client, file_id, page_token, referer).await {
            return Ok((url, meta.file_name));
        }
    }

    Err(HosterError::ResolutionFailed(metadata_denied_message(
        &meta,
    )))
}

pub async fn resolve(
    client: &reqwest::Client,
    url: &str,
) -> Result<(String, String, Option<String>), HosterError> {
    let short_id = extract_short_id(url)?;
    let referer = format!("{ROOTZ_ORIGIN}/d/{short_id}");
    let page_url = referer.clone();

    let page_token = fetch_page_token(client, &page_url).await?;
    let (direct_url, file_name_hint) =
        resolve_direct_url(client, &short_id, &page_token, &referer).await?;

    Ok((direct_url, referer, file_name_hint))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_page_token_from_next_payload() {
        let html = r#"shortId\":\"abc\",\"pageToken\":\"tok.test_123\""#;
        assert_eq!(extract_page_token(html).unwrap(), "tok.test_123");
    }

    #[test]
    fn extracts_short_id_from_d_path() {
        assert_eq!(
            extract_short_id("https://www.rootz.so/d/2Gbi2y").unwrap(),
            "2Gbi2y"
        );
    }

    #[test]
    fn metadata_denied_prefers_password_message() {
        let data = RootzData {
            url: None,
            file_id: None,
            file_name: Some("game.zip".into()),
            download_allowed: Some(false),
            password_protected: Some(true),
            status: Some("active".into()),
            remaining_downloads: Some(-1),
        };
        assert!(metadata_denied_message(&data).contains("contraseña"));
        assert!(metadata_denied_message(&data).contains("game.zip"));
    }

    #[test]
    fn download_allowed_false_with_file_id_gets_retry_hint() {
        let data = RootzData {
            url: None,
            file_id: Some("uuid-here".into()),
            file_name: Some("Bellwright.v0.0.46862.RexaGames.com.zip".into()),
            download_allowed: Some(false),
            password_protected: None,
            status: Some("deleted".into()),
            remaining_downloads: Some(-1),
        };
        let msg = metadata_denied_message(&data);
        assert!(!msg.contains("no permite descarga automática"));
        assert!(msg.contains("navegador"));
    }
}
