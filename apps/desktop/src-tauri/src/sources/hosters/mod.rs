//! Resolución de enlaces de hosters gratuitos

mod buzzheavier;
mod datanodes;
mod fuckingfast;
mod gofile;
mod mediafire;
mod pixeldrain;
mod rootz;
mod vikingfile;

pub mod error;

use std::borrow::Cow;

use reqwest::Client;

use crate::network::{DownloadProfile, ProfilePreset, HOSTER_DOWNLOAD_CLIENT};

pub use error::HosterError;

/// Resultado de resolver una URI: URL efectiva y perfil para el GET de descarga.
pub struct ResolvedDownload<'a> {
    pub url: Cow<'a, str>,
    pub download_profile: DownloadProfile,
    /// Nombre de archivo sugerido por el hoster (extensión correcta).
    pub file_name_hint: Option<String>,
}

fn normalized_host(url: &reqwest::Url) -> String {
    url.host_str()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase()
}

/// Resuelve la URL directa y el perfil de descarga usando el cliente compartido con cookie jar.
#[allow(dead_code)]
pub async fn resolve_download_url<'a>(uri: &'a str) -> Result<ResolvedDownload<'a>, HosterError> {
    resolve_download_url_with_client(&HOSTER_DOWNLOAD_CLIENT, uri).await
}

/// Igual que [`resolve_download_url`] pero con un cliente explícito (misma sesión resolve + download).
pub async fn resolve_download_url_with_client<'a>(
    client: &Client,
    uri: &'a str,
) -> Result<ResolvedDownload<'a>, HosterError> {
    let parsed = reqwest::Url::parse(uri).map_err(|_| HosterError::InvalidUrl(uri.to_string()))?;
    let host = normalized_host(&parsed);

    if host.contains("gofile.io") {
        let (url, account_token) = gofile::resolve(client, uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::GofileDownload { account_token }.build(),
            file_name_hint: None,
        });
    }

    if host.contains("mediafire.com") {
        let (url, referer) = mediafire::resolve(client, uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::BrowserSameOrigin { referer }.build(),
            file_name_hint: None,
        });
    }

    if host.contains("pixeldrain.com") {
        let (url, referer) = pixeldrain::resolve(client, uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::BrowserSameOrigin { referer }.build(),
            file_name_hint: None,
        });
    }

    if host.contains("datanodes.to") {
        let url = datanodes::resolve(client, uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::DatanodesDownload.build(),
            file_name_hint: None,
        });
    }

    if buzzheavier::is_supported_domain(uri) {
        let (url, page_url) = buzzheavier::resolve(client, uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::Downloader { referer: page_url }.build(),
            file_name_hint: None,
        });
    }

    if fuckingfast::is_supported_domain(uri) {
        let (url, page_url) = fuckingfast::resolve(client, uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::Downloader { referer: page_url }.build(),
            file_name_hint: None,
        });
    }

    if vikingfile::is_vikingfile_url(uri) {
        let (url, referer, name_hint) = vikingfile::resolve(client, uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::Downloader { referer }.build(),
            file_name_hint: name_hint,
        });
    }

    if host.contains("rootz.so") {
        let (url, referer) = rootz::resolve(client, uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::BrowserSameOrigin { referer }.build(),
            file_name_hint: None,
        });
    }

    Ok(ResolvedDownload {
        url: Cow::Borrowed(uri),
        download_profile: ProfilePreset::Passthrough.build(),
        file_name_hint: None,
    })
}

impl HosterError {
    pub fn to_user_string(&self) -> String {
        match self {
            HosterError::Network(err) => network_user_message(err),
            _ => self.to_string(),
        }
    }
}

fn network_user_message(err: &reqwest::Error) -> String {
    if err.is_decode() {
        return "El hoster devolvió una página web en lugar de datos válidos (suele ser Cloudflare/CAPTCHA o el servicio caído). Abre el enlace en el navegador.".into();
    }
    if err.is_timeout() {
        return "El hoster no respondió a tiempo. Si la web del hoster tampoco carga en el navegador, puede estar caído o bloqueado en tu red.".into();
    }
    if err.is_connect() {
        return "No se pudo conectar con el hoster (red, DNS o servicio caído). Comprueba que el enlace abre en el navegador.".into();
    }
    format!("Error de red: {err}")
}

#[cfg(test)]
mod tests {
    use super::gofile::generate_website_token_at;

    #[test]
    fn gofile_token_slotted() {
        let a = generate_website_token_at("tok", 5);
        let b = generate_website_token_at("tok", 5);
        assert_eq!(a, b);
        let c = generate_website_token_at("tok", 6);
        assert_ne!(a, c);
    }
}
