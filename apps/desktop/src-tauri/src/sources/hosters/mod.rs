//! Resolución de enlaces de hosters gratuitos 

mod buzzheavier;
mod constants;
mod datanodes;
mod fuckingfast;
mod gofile;
mod mediafire;
mod pixeldrain;
mod rootz;
mod vikingfile;

pub mod error;

use std::borrow::Cow;

pub use error::HosterError;

/// Resultado de resolver una URI: URL efectiva para el GET y cookie opcional (Gofile).
pub struct ResolvedDownload<'a> {
    pub url: Cow<'a, str>,
    pub cookie: Option<String>,
}

fn normalized_host(url: &reqwest::Url) -> String {
    url.host_str()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_ascii_lowercase()
}

/// Si el host es conocido, obtiene la URL directa; si no, devuelve el mismo URI sin asignar.
pub async fn resolve_download_url<'a>(
    uri: &'a str,
) -> Result<ResolvedDownload<'a>, HosterError> {
    let parsed = reqwest::Url::parse(uri).map_err(|_| HosterError::InvalidUrl(uri.to_string()))?;
    let host = normalized_host(&parsed);

    if host.contains("gofile.io") {
        let (url, token) = gofile::resolve(uri).await?;
        let cookie = format!("accountToken={token}");
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            cookie: Some(cookie),
        });
    }

    if host.contains("mediafire.com") {
        let url = mediafire::resolve(uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            cookie: None,
        });
    }

    if host.contains("pixeldrain.com") {
        let url = pixeldrain::resolve(uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            cookie: None,
        });
    }

    if host.contains("datanodes.to") {
        let url = datanodes::resolve(uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            cookie: None,
        });
    }

    if buzzheavier::is_supported_domain(uri) {
        let url = buzzheavier::resolve(uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            cookie: None,
        });
    }

    if fuckingfast::is_supported_domain(uri) {
        let url = fuckingfast::resolve(uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            cookie: None,
        });
    }

    if vikingfile::is_vikingfile_host(&host) {
        return Err(HosterError::VikingFileNimbus);
    }

    if host.contains("rootz.so") {
        let url = rootz::resolve(uri).await?;
        return Ok(ResolvedDownload {
            url: Cow::Owned(url),
            cookie: None,
        });
    }

    Ok(ResolvedDownload {
        url: Cow::Borrowed(uri),
        cookie: None,
    })
}

impl HosterError {
    pub fn to_user_string(&self) -> String {
        self.to_string()
    }
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
