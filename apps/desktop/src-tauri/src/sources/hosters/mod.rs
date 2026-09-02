//! Resolución de enlaces de hosters gratuitos

mod akirabox;
mod buzzheavier;
mod datanodes;
mod filekeeper;
mod fuckingfast;
mod gofile;
mod html_utils;
mod mediafire;
mod onefichier;
mod pixeldrain;
mod rootz;
mod vikingfile;

pub mod error;

use std::borrow::Cow;

use reqwest::Client;
use tauri::AppHandle;

use crate::network::{get_hoster_download_client, DownloadProfile, ProfilePreset};

pub use error::HosterError;

/// Resultado de resolver una URI: URL efectiva y perfil para el GET de descarga.
pub struct ResolvedDownload<'a> {
    pub url: Cow<'a, str>,
    pub download_profile: DownloadProfile,
    /// Nombre de archivo sugerido por el hoster (extensión correcta).
    pub file_name_hint: Option<String>,
}

fn is_signed_cdn_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.contains("cloudflarestorage.com")
        || lower.contains("alcyone.so")
        || lower.contains(".r2.cloudflarestorage.com")
}

fn normalized_host(url: &reqwest::Url) -> String {
    url.host_str()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase()
}

/// Resuelve la URL directa y el perfil de descarga usando el cliente compartido con cookie jar.
#[allow(dead_code)]
pub async fn resolve_download_url<'a>(
    app: Option<&AppHandle>,
    uri: &'a str,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<ResolvedDownload<'a>, HosterError> {
    let client = get_hoster_download_client();
    resolve_download_url_with_client(app, &client, uri, cancel_flag).await
}

/// Igual que [`resolve_download_url`] pero con un cliente explícito (misma sesión resolve + download).
pub async fn resolve_download_url_with_client<'a>(
    app: Option<&AppHandle>,
    client: &Client,
    uri: &'a str,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
) -> Result<ResolvedDownload<'a>, HosterError> {
    match resolve_hoster_url_internal(app, client, uri, cancel_flag.clone()).await {
        Ok(res) => Ok(res),
        Err(e) => {
            if let Some(app) = app {
                log::info!(
                    "Hoster resolution failed: {:?}. Attempting Scrapling fallback for: {}",
                    e,
                    uri
                );
                match crate::sources::commands::fetch::run_scrapling_fetch(app, uri, cancel_flag) {
                    Ok(stdout) => {
                        let trimmed = stdout.trim();
                        if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                            log::info!("Scrapling successfully resolved download URL: {}", trimmed);
                            return Ok(ResolvedDownload {
                                url: Cow::Owned(trimmed.to_string()),
                                download_profile: ProfilePreset::Passthrough.build(),
                                file_name_hint: None,
                            });
                        }
                    }
                    Err(scrapling_err) => {
                        log::error!("Scrapling resolution failed: {}", scrapling_err);
                    }
                }
            }
            Err(e)
        }
    }
}

async fn resolve_hoster_url_internal<'a>(
    app: Option<&AppHandle>,
    client: &Client,
    uri: &'a str,
    cancel_flag: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
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

    if host.contains("1fichier.com") {
        let (url, page_url) = onefichier::resolve(app, client, uri, cancel_flag.clone()).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::BrowserSameOrigin { referer: page_url }.build(),
            file_name_hint: None,
        });
    }

    if host.contains("akirabox.com") || host.contains("akirabox.to") {
        let (url, _page_url) = akirabox::resolve(app, client, uri, cancel_flag.clone()).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile: ProfilePreset::Passthrough.build(),
            file_name_hint: None,
        });
    }

    if host.contains("filekeeper.net") {
        let (url, page_url) = filekeeper::resolve(app, client, uri, cancel_flag.clone()).await?;
        let download_profile = if is_signed_cdn_url(&url)
            || !normalized_host(
                &reqwest::Url::parse(&url).map_err(|_| HosterError::InvalidUrl(url.clone()))?,
            )
            .contains("filekeeper.net")
        {
            ProfilePreset::Passthrough.build()
        } else {
            ProfilePreset::BrowserSameOrigin { referer: page_url }.build()
        };
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile,
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
        let (url, page_url) = buzzheavier::resolve(app, client, uri, cancel_flag.clone()).await?;
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
        let (url, referer, file_name_hint) =
            rootz::resolve(app, client, uri, cancel_flag.clone()).await?;
        let download_profile = if is_signed_cdn_url(&url) {
            ProfilePreset::Passthrough.build()
        } else {
            ProfilePreset::BrowserSameOrigin { referer }.build()
        };
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            download_profile,
            file_name_hint,
        });
    }

    Ok(ResolvedDownload {
        url: Cow::Borrowed(uri),
        download_profile: ProfilePreset::Passthrough.build(),
        file_name_hint: None,
    })
}

#[cfg(test)]
mod tests {
    use super::gofile::generate_website_token_at;

    #[test]
    fn gofile_token_slotted() {
        let a = generate_website_token_at("tok", 5, "5d4f7g8sd45fsd");
        let b = generate_website_token_at("tok", 5, "5d4f7g8sd45fsd");
        assert_eq!(a, b);
        let c = generate_website_token_at("tok", 6, "5d4f7g8sd45fsd");
        assert_ne!(a, c);
    }
}
