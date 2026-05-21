//! Cliente HTTP, perfiles de cabeceras y helpers para hosters de descarga.
//!
//! Única fuente de verdad para User-Agent, Referer, cookies y peticiones de resolución/descarga.
//! Los módulos en `sources/hosters/` solo contienen lógica de negocio (parseo, API, regex).

use std::borrow::Cow;
use std::sync::LazyLock;
use std::time::Duration;

use reqwest::header::{HeaderName, HeaderValue};
use reqwest::redirect::Policy;
use reqwest::{Client, RequestBuilder, Response};

pub const HOSTER_BROWSER_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub const HOSTER_DOWNLOADER_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0";

const GOFILE_ORIGIN: &str = "https://gofile.io";
const GOFILE_REFERER: &str = "https://gofile.io/";
const GOFILE_LANGUAGE: &str = "en-US";

/// Valor de `appdata.wt` en https://gofile.io/dist/js/config.js (usado por la API).
pub const GOFILE_STATIC_WEBSITE_TOKEN: &str = "4fd6sg89d7s6";
const DATANODES_REFERER: &str = "https://datanodes.to/download";

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const SHORT_TIMEOUT: Duration = Duration::from_secs(30);
const PIXELDRAIN_HEAD_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RequestPhase {
    Resolve,
    Download,
}

#[derive(Debug, Clone)]
pub struct HttpStatusError {
    pub phase: RequestPhase,
    pub status: u16,
}

impl HttpStatusError {
    pub fn user_message(&self) -> String {
        let phase = match self.phase {
            RequestPhase::Resolve => "al resolver el enlace",
            RequestPhase::Download => "al descargar el archivo",
        };
        match self.status {
            401 => format!("Sesión inválida o enlace caducado {phase} (HTTP 401)"),
            403 => format!("Acceso denegado {phase} (hotlink o anti-bot, HTTP 403)"),
            404 => format!("Archivo no encontrado {phase} (HTTP 404)"),
            429 => format!("Demasiadas peticiones {phase}; inténtalo más tarde (HTTP 429)"),
            n => format!("Error HTTP {n} {phase}"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct DownloadProfile {
    pub user_agent: &'static str,
    pub referer: Option<Cow<'static, str>>,
    pub origin: Option<Cow<'static, str>>,
    pub cookie: Option<String>,
    pub extras: Vec<(&'static str, String)>,
}

impl DownloadProfile {
    pub fn passthrough() -> Self {
        Self {
            user_agent: HOSTER_BROWSER_USER_AGENT,
            referer: None,
            origin: None,
            cookie: None,
            extras: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub enum ProfilePreset {
    BrowserSameOrigin {
        referer: String,
    },
    #[allow(dead_code)]
    BrowserCrossOrigin {
        referer: String,
        origin: String,
    },
    Downloader {
        referer: String,
    },
    GofileCreateAccount,
    GofileApi {
        account_token: String,
        /// Si es `None`, usa [`GOFILE_STATIC_WEBSITE_TOKEN`].
        website_token: Option<String>,
    },
    GofileDownload {
        account_token: String,
    },
    DatanodesResolve,
    DatanodesDownload,
    BuzzheavierPage,
    BuzzheavierHead {
        page_url: String,
    },
    PixeldrainBypass,
    PixeldrainCheck {
        page_url: String,
    },
    RootzApi,
    VikingfileApi,
    Passthrough,
}

impl ProfilePreset {
    pub fn build(self) -> DownloadProfile {
        match self {
            ProfilePreset::BrowserSameOrigin { referer } => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: Some(Cow::Owned(referer)),
                origin: None,
                cookie: None,
                extras: vec![("Accept", "*/*".to_string())],
            },
            ProfilePreset::BrowserCrossOrigin { referer, origin } => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: Some(Cow::Owned(referer)),
                origin: Some(Cow::Owned(origin)),
                cookie: None,
                extras: vec![("Accept", "*/*".to_string())],
            },
            ProfilePreset::Downloader { referer } => DownloadProfile {
                user_agent: HOSTER_DOWNLOADER_USER_AGENT,
                referer: Some(Cow::Owned(referer)),
                origin: None,
                cookie: None,
                extras: vec![("Accept", "*/*".to_string())],
            },
            ProfilePreset::GofileCreateAccount => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: Some(Cow::Borrowed(GOFILE_REFERER)),
                origin: Some(Cow::Borrowed(GOFILE_ORIGIN)),
                cookie: None,
                extras: vec![
                    ("Accept", "*/*".to_string()),
                    ("Connection", "keep-alive".to_string()),
                ],
            },
            ProfilePreset::GofileApi {
                account_token,
                website_token,
            } => {
                let wt = website_token.unwrap_or_else(|| GOFILE_STATIC_WEBSITE_TOKEN.to_string());
                DownloadProfile {
                    user_agent: HOSTER_BROWSER_USER_AGENT,
                    referer: Some(Cow::Borrowed(GOFILE_REFERER)),
                    origin: Some(Cow::Borrowed(GOFILE_ORIGIN)),
                    cookie: None,
                    extras: vec![
                        ("Authorization", format!("Bearer {account_token}")),
                        ("X-Website-Token", wt),
                        ("X-BL", GOFILE_LANGUAGE.to_string()),
                        ("Accept", "*/*".to_string()),
                    ],
                }
            }
            ProfilePreset::GofileDownload { account_token } => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: Some(Cow::Borrowed(GOFILE_REFERER)),
                origin: Some(Cow::Borrowed(GOFILE_ORIGIN)),
                cookie: Some(format!("accountToken={account_token}")),
                extras: vec![("Accept", "*/*".to_string())],
            },
            ProfilePreset::DatanodesResolve => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: Some(Cow::Borrowed(DATANODES_REFERER)),
                origin: None,
                cookie: Some("lang=english".to_string()),
                extras: vec![
                    ("accept", "*/*".to_string()),
                    ("accept-language", "en-US,en;q=0.9".to_string()),
                    ("priority", "u=1, i".to_string()),
                    (
                        "sec-ch-ua",
                        r#""Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141""#
                            .to_string(),
                    ),
                    ("sec-ch-ua-mobile", "?0".to_string()),
                    ("sec-ch-ua-platform", "\"Windows\"".to_string()),
                    ("sec-fetch-dest", "empty".to_string()),
                    ("sec-fetch-mode", "cors".to_string()),
                    ("sec-fetch-site", "same-origin".to_string()),
                ],
            },
            ProfilePreset::DatanodesDownload => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: Some(Cow::Borrowed(DATANODES_REFERER)),
                origin: None,
                cookie: None,
                extras: vec![("Accept", "*/*".to_string())],
            },
            ProfilePreset::BuzzheavierPage => DownloadProfile {
                user_agent: HOSTER_DOWNLOADER_USER_AGENT,
                referer: None,
                origin: None,
                cookie: None,
                extras: Vec::new(),
            },
            ProfilePreset::BuzzheavierHead { page_url } => DownloadProfile {
                user_agent: HOSTER_DOWNLOADER_USER_AGENT,
                referer: Some(Cow::Owned(page_url.clone())),
                origin: None,
                cookie: None,
                extras: vec![
                    ("hx-current-url", page_url),
                    ("hx-request", "true".to_string()),
                ],
            },
            ProfilePreset::PixeldrainBypass => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: None,
                origin: None,
                cookie: None,
                extras: Vec::new(),
            },
            ProfilePreset::PixeldrainCheck { page_url } => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: Some(Cow::Owned(page_url)),
                origin: None,
                cookie: None,
                extras: Vec::new(),
            },
            ProfilePreset::RootzApi => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: Some(Cow::Borrowed("https://www.rootz.so/")),
                origin: None,
                cookie: None,
                extras: vec![("Accept", "application/json".to_string())],
            },
            ProfilePreset::VikingfileApi => DownloadProfile {
                user_agent: HOSTER_BROWSER_USER_AGENT,
                referer: Some(Cow::Borrowed("https://vikingfile.com/")),
                origin: Some(Cow::Borrowed("https://vikingfile.com")),
                cookie: None,
                extras: vec![("Accept", "*/*".to_string())],
            },
            ProfilePreset::Passthrough => DownloadProfile::passthrough(),
        }
    }
}

pub static HOSTER_DOWNLOAD_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .user_agent(HOSTER_BROWSER_USER_AGENT)
        .cookie_store(true)
        .timeout(REQUEST_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .tcp_nodelay(true)
        .build()
        .expect("fallo critico al inicializar HOSTER_DOWNLOAD_CLIENT")
});

pub static HOSTER_NO_REDIRECT_CLIENT: LazyLock<Client> = LazyLock::new(|| {
    Client::builder()
        .user_agent(HOSTER_DOWNLOADER_USER_AGENT)
        .redirect(Policy::none())
        .timeout(SHORT_TIMEOUT)
        .connect_timeout(CONNECT_TIMEOUT)
        .tcp_nodelay(true)
        .build()
        .expect("fallo critico al inicializar HOSTER_NO_REDIRECT_CLIENT")
});

fn insert_header(builder: RequestBuilder, name: &'static str, value: &str) -> RequestBuilder {
    if let (Ok(n), Ok(v)) = (
        HeaderName::from_bytes(name.as_bytes()),
        HeaderValue::from_str(value),
    ) {
        builder.header(n, v)
    } else {
        builder
    }
}

pub fn apply_profile(builder: RequestBuilder, profile: &DownloadProfile) -> RequestBuilder {
    let mut b = builder.header("User-Agent", profile.user_agent);
    if let Some(ref r) = profile.referer {
        b = insert_header(b, "Referer", r);
    }
    if let Some(ref o) = profile.origin {
        b = insert_header(b, "Origin", o);
    }
    if let Some(ref c) = profile.cookie {
        b = insert_header(b, "Cookie", c);
    }
    for (name, value) in &profile.extras {
        b = insert_header(b, name, value);
    }
    b
}

pub fn ensure_resolve_success(response: Response) -> Result<Response, HttpStatusError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let code = status.as_u16();
    if matches!(code, 301 | 302 | 303 | 307 | 308 | 204) {
        return Ok(response);
    }
    Err(HttpStatusError {
        phase: RequestPhase::Resolve,
        status: code,
    })
}

pub fn ensure_download_success(response: Response) -> Result<Response, HttpStatusError> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    Err(HttpStatusError {
        phase: RequestPhase::Download,
        status: status.as_u16(),
    })
}

pub async fn get(
    client: &Client,
    url: &str,
    preset: ProfilePreset,
) -> Result<Response, reqwest::Error> {
    let profile = preset.build();
    apply_profile(client.get(url), &profile).send().await
}

pub async fn get_with_profile(
    client: &Client,
    url: &str,
    profile: &DownloadProfile,
) -> Result<Response, reqwest::Error> {
    apply_profile(client.get(url), profile).send().await
}

#[allow(dead_code)]
pub async fn head(
    client: &Client,
    url: &str,
    preset: ProfilePreset,
) -> Result<Response, reqwest::Error> {
    let profile = preset.build();
    apply_profile(client.head(url), &profile).send().await
}

pub async fn head_short(
    client: &Client,
    url: &str,
    preset: ProfilePreset,
) -> Result<Response, reqwest::Error> {
    let profile = preset.build();
    apply_profile(client.head(url).timeout(PIXELDRAIN_HEAD_TIMEOUT), &profile)
        .send()
        .await
}

pub async fn head_no_redirect(
    url: &str,
    preset: ProfilePreset,
) -> Result<Response, reqwest::Error> {
    let profile = preset.build();
    apply_profile(HOSTER_NO_REDIRECT_CLIENT.head(url), &profile)
        .send()
        .await
}

#[allow(dead_code)]
pub async fn post(
    client: &Client,
    url: &str,
    preset: ProfilePreset,
) -> Result<Response, reqwest::Error> {
    let profile = preset.build();
    apply_profile(client.post(url), &profile).send().await
}

pub async fn post_form_urlencoded(
    client: &Client,
    url: &str,
    preset: ProfilePreset,
    fields: &[(&str, &str)],
) -> Result<Response, reqwest::Error> {
    let profile = preset.build();
    apply_profile(client.post(url).form(fields), &profile)
        .send()
        .await
}

pub async fn post_json(
    client: &Client,
    url: &str,
    preset: ProfilePreset,
    body: &str,
) -> Result<Response, reqwest::Error> {
    let profile = preset.build();
    apply_profile(
        client
            .post(url)
            .header("Content-Type", "application/json")
            .body(body.to_string()),
        &profile,
    )
    .send()
    .await
}

pub async fn post_multipart(
    client: &Client,
    url: &str,
    preset: ProfilePreset,
    form: reqwest::multipart::Form,
) -> Result<Response, reqwest::Error> {
    let profile = preset.build();
    apply_profile(client.post(url).multipart(form), &profile)
        .send()
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gofile_download_profile_has_cookie_and_referer() {
        let p = ProfilePreset::GofileDownload {
            account_token: "abc".into(),
        }
        .build();
        assert_eq!(p.cookie.as_deref(), Some("accountToken=abc"));
        assert_eq!(p.referer.as_deref(), Some(GOFILE_REFERER));
        assert_eq!(p.origin.as_deref(), Some(GOFILE_ORIGIN));
    }

    #[test]
    fn buzzheavier_head_includes_hx_headers() {
        let p = ProfilePreset::BuzzheavierHead {
            page_url: "https://buzzheavier.com/f/abc".to_string(),
        }
        .build();
        let names: Vec<_> = p.extras.iter().map(|(k, _)| *k).collect();
        assert!(names.contains(&"hx-current-url"));
        assert!(names.contains(&"hx-request"));
    }

    #[test]
    fn http_status_error_messages() {
        let e = HttpStatusError {
            phase: RequestPhase::Download,
            status: 401,
        };
        assert!(e.user_message().contains("401"));
    }
}
