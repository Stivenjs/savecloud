//! Resolución de enlaces Gofile

use std::sync::LazyLock;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use hex::encode as hex_encode;
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex as AsyncMutex;

use crate::network::{get, post_json, ProfilePreset, HOSTER_BROWSER_USER_AGENT};

use super::error::{ensure_resolve, HosterError};

static GOFILE_ACCOUNT_TOKEN: Mutex<Option<String>> = Mutex::new(None);
static GOFILE_CREATE_LOCK: LazyLock<AsyncMutex<()>> = LazyLock::new(|| AsyncMutex::new(()));

const GOFILE_LANGUAGE: &str = "en-US";
const GOFILE_WT_SUFFIX: &str = "5d4f7g8sd45fsd";
const GOFILE_TIME_SLOT_SECS: u64 = 14_400;
const GOFILE_MAX_RETRIES: u32 = 3;
const GOFILE_RESOLVE_TIMEOUT: Duration = Duration::from_secs(90);
const GOFILE_MAX_FOLDER_DEPTH: u32 = 4;
const GOFILE_MAX_FOLDER_ENTRIES: usize = 40;

fn time_slot_now() -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    now / GOFILE_TIME_SLOT_SECS
}

fn clear_account_token() {
    if let Ok(mut guard) = GOFILE_ACCOUNT_TOKEN.lock() {
        *guard = None;
    }
}

pub(crate) fn generate_website_token_at(account_token: &str, time_slot: u64) -> String {
    let raw = format!(
        "{HOSTER_BROWSER_USER_AGENT}::{GOFILE_LANGUAGE}::{account_token}::{time_slot}::{GOFILE_WT_SUFFIX}"
    );
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex_encode(hasher.finalize())
}

async fn backoff(attempt: u32) {
    let secs = 2u64.saturating_pow(attempt.min(2));
    tokio::time::sleep(Duration::from_secs(secs)).await;
}

fn is_retryable_status(status: u16) -> bool {
    status == 429 || status == 503
}

fn is_auth_error(err: &HosterError) -> bool {
    err.to_string().contains("401")
}

fn is_rate_limit_error(err: &HosterError) -> bool {
    let s = err.to_string();
    s.contains("429") || s.contains("503") || s.contains("límite de peticiones")
}

#[derive(Deserialize)]
struct GofileAccountsEnvelope {
    status: String,
    data: Option<GofileAccountsData>,
}

#[derive(Deserialize)]
struct GofileAccountsData {
    token: String,
}

#[derive(Deserialize)]
struct GofileContentsEnvelope {
    status: String,
    data: Option<GofileContentsBody>,
}

#[derive(Deserialize)]
struct GofileContentsBody {
    #[serde(rename = "type")]
    content_type: String,
    link: Option<String>,
    name: Option<String>,
    children: Option<std::collections::HashMap<String, GofileChild>>,
}

#[derive(Deserialize)]
struct GofileChild {
    id: String,
    #[serde(rename = "type")]
    child_type: String,
    link: Option<String>,
    name: Option<String>,
}

fn extract_content_id(url: &reqwest::Url) -> Option<String> {
    let parts: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() >= 2 && parts[0] == "d" {
        return Some(parts[1].to_string());
    }
    None
}

async fn create_guest_account(client: &Client) -> Result<String, HosterError> {
    let mut last_err = HosterError::ResolutionFailed("gofile: sin respuesta".into());

    for attempt in 0..GOFILE_MAX_RETRIES {
        if attempt > 0 {
            backoff(attempt).await;
        }

        let response = match post_json(
            client,
            "https://api.gofile.io/accounts",
            ProfilePreset::GofileCreateAccount,
            "{}",
        )
        .await
        {
            Ok(r) => r,
            Err(e) => {
                last_err = HosterError::Network(e);
                continue;
            }
        };

        let status = response.status().as_u16();
        if is_retryable_status(status) {
            last_err = HosterError::ResolutionFailed(format!(
                "gofile: límite de peticiones al crear cuenta (HTTP {status})"
            ));
            continue;
        }

        let response = match ensure_resolve(response) {
            Ok(r) => r,
            Err(e) => {
                last_err = e;
                continue;
            }
        };

        let parsed: GofileAccountsEnvelope = match response.json().await {
            Ok(p) => p,
            Err(e) => {
                last_err = HosterError::Network(e);
                continue;
            }
        };

        if parsed.status != "ok" {
            last_err = HosterError::ResolutionFailed(format!(
                "gofile: creación de cuenta: {}",
                parsed.status
            ));
            continue;
        }

        return parsed
            .data
            .map(|d| d.token)
            .ok_or_else(|| HosterError::ResolutionFailed("gofile: sin token".into()));
    }

    Err(last_err)
}

async fn ensure_account_token(client: &Client) -> Result<String, HosterError> {
    {
        let guard = GOFILE_ACCOUNT_TOKEN
            .lock()
            .map_err(|_| HosterError::ResolutionFailed("gofile: mutex de token".into()))?;
        if let Some(ref t) = *guard {
            return Ok(t.clone());
        }
    }

    let _create_guard = GOFILE_CREATE_LOCK.lock().await;

    {
        let guard = GOFILE_ACCOUNT_TOKEN
            .lock()
            .map_err(|_| HosterError::ResolutionFailed("gofile: mutex de token".into()))?;
        if let Some(ref t) = *guard {
            return Ok(t.clone());
        }
    }

    let token = create_guest_account(client).await?;
    if let Ok(mut guard) = GOFILE_ACCOUNT_TOKEN.lock() {
        *guard = Some(token.clone());
    }
    Ok(token)
}

async fn refresh_account_token(client: &Client) -> Result<String, HosterError> {
    clear_account_token();
    let _create_guard = GOFILE_CREATE_LOCK.lock().await;
    let token = create_guest_account(client).await?;
    if let Ok(mut guard) = GOFILE_ACCOUNT_TOKEN.lock() {
        *guard = Some(token.clone());
    }
    Ok(token)
}

async fn fetch_contents(
    client: &Client,
    id: &str,
    account_token: &str,
    password: Option<&str>,
) -> Result<GofileContentsBody, HosterError> {
    let dynamic = generate_website_token_at(account_token, time_slot_now());
    let mut q =
        String::from("cache=true&page=1&pageSize=1000&sortField=createTime&sortDirection=1");
    if let Some(p) = password {
        q.push_str("&password=");
        q.push_str(&urlencoding::encode(p));
    }

    let url = format!("https://api.gofile.io/contents/{id}?{q}");
    let response = get(
        client,
        &url,
        ProfilePreset::GofileApi {
            account_token: account_token.to_string(),
            website_token: Some(dynamic),
        },
    )
    .await?;

    let status = response.status().as_u16();
    if status == 401 {
        return Err(HosterError::ResolutionFailed(
            "gofile: sesión inválida (HTTP 401)".into(),
        ));
    }
    if is_retryable_status(status) {
        return Err(HosterError::ResolutionFailed(format!(
            "gofile: límite de peticiones (HTTP {status})"
        )));
    }

    let response = ensure_resolve(response)?;
    let envelope: GofileContentsEnvelope = response
        .json()
        .await
        .map_err(|e| super::error::map_json_error(e, "gofile"))?;
    if envelope.status != "ok" {
        return Err(HosterError::ResolutionFailed(format!(
            "gofile: API respondió: {}",
            envelope.status
        )));
    }
    envelope
        .data
        .ok_or_else(|| HosterError::ResolutionFailed("gofile: cuerpo vacío".into()))
}

async fn get_contents(
    client: &Client,
    id: &str,
    account_token: &str,
    password: Option<&str>,
) -> Result<GofileContentsBody, HosterError> {
    let mut last_err = HosterError::ResolutionFailed("gofile: sin respuesta".into());
    let mut token = account_token.to_string();

    for attempt in 0..GOFILE_MAX_RETRIES {
        if attempt > 0 {
            backoff(attempt).await;
        }

        match fetch_contents(client, id, &token, password).await {
            Ok(body) => return Ok(body),
            Err(e) if is_auth_error(&e) => {
                token = refresh_account_token(client).await?;
                last_err = e;
            }
            Err(e) if is_rate_limit_error(&e) => {
                last_err = e;
            }
            Err(e) => return Err(e),
        }
    }

    Err(last_err)
}

async fn parse_links_recursively(
    client: &Client,
    id: &str,
    account_token: &str,
    password: Option<&str>,
    depth: u32,
    scanned: &mut usize,
) -> Result<Option<(String, Option<String>)>, HosterError> {
    if depth > GOFILE_MAX_FOLDER_DEPTH || *scanned >= GOFILE_MAX_FOLDER_ENTRIES {
        return Ok(None);
    }

    let data = get_contents(client, id, account_token, password).await?;
    *scanned += 1;

    if data.content_type == "file" {
        return Ok(data.link.map(|url| (url, data.name)));
    }
    if data.content_type != "folder" {
        return Err(HosterError::ResolutionFailed(
            "gofile: tipo de contenido no soportado".into(),
        ));
    }

    let mut children: Vec<GofileChild> = data
        .children
        .map(|m| m.into_values().collect())
        .unwrap_or_default();
    children.sort_by(|a, b| a.name.cmp(&b.name));

    for child in children {
        if *scanned >= GOFILE_MAX_FOLDER_ENTRIES {
            break;
        }
        if child.child_type == "file" {
            if let Some(link) = child.link {
                return Ok(Some((link, child.name)));
            }
        } else if child.child_type == "folder" {
            if let Some(found) = Box::pin(parse_links_recursively(
                client,
                &child.id,
                account_token,
                password,
                depth + 1,
                scanned,
            ))
            .await?
            {
                return Ok(Some(found));
            }
        }
    }
    Ok(None)
}

async fn resolve_inner(client: &Client, url: &str) -> Result<(String, String), HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let id = extract_content_id(&parsed)
        .ok_or_else(|| HosterError::ResolutionFailed("gofile: URL sin id /d/...".into()))?;

    let account_token = ensure_account_token(client).await?;
    let mut scanned = 0usize;
    let (direct, _name) =
        parse_links_recursively(client, &id, &account_token, None, 0, &mut scanned)
            .await?
            .ok_or_else(|| {
                HosterError::ResolutionFailed("gofile: sin enlaces de archivo".into())
            })?;

    Ok((direct, account_token))
}

/// Resuelve la URL de descarga directa y el token de cuenta para el perfil de descarga.
pub async fn resolve(client: &Client, url: &str) -> Result<(String, String), HosterError> {
    tokio::time::timeout(GOFILE_RESOLVE_TIMEOUT, resolve_inner(client, url))
        .await
        .map_err(|_| {
            HosterError::ResolutionFailed(
                "gofile: tiempo de espera agotado al resolver el enlace (90s)".into(),
            )
        })?
}

#[cfg(test)]
mod tests {
    use sha2::Digest;

    use super::generate_website_token_at;

    #[test]
    fn website_token_matches_gallery_dl_vector() {
        let token = generate_website_token_at("tok", 5);
        let raw = format!(
            "{}::en-US::tok::5::5d4f7g8sd45fsd",
            crate::network::HOSTER_BROWSER_USER_AGENT
        );
        let mut hasher = sha2::Sha256::new();
        hasher.update(raw.as_bytes());
        let expected = hex::encode(hasher.finalize());
        assert_eq!(token, expected);
    }
}
