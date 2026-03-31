//! Resolución de enlaces Gofile 

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use hex::encode as hex_encode;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::network::{HOSTER_BROWSER_USER_AGENT, HOSTER_CLIENT};

use super::error::HosterError;

static GOFILE_ACCOUNT_TOKEN: Mutex<Option<String>> = Mutex::new(None);

const GOFILE_LANGUAGE: &str = "en-US";
const GOFILE_SUFFIX: &str = "gf2026x";
const GOFILE_TIME_SLOT_SECS: u64 = 14_400;

fn time_slot_now() -> u64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    now / GOFILE_TIME_SLOT_SECS
}

/// Genera `X-Website-Token` (SHA-256 hex) 
pub(crate) fn generate_website_token(account_token: &str) -> String {
    generate_website_token_at(account_token, time_slot_now())
}

pub(crate) fn generate_website_token_at(account_token: &str, time_slot: u64) -> String {
    let raw = format!(
        "{HOSTER_BROWSER_USER_AGENT}::{GOFILE_LANGUAGE}::{account_token}::{time_slot}::{GOFILE_SUFFIX}"
    );
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex_encode(hasher.finalize())
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
    children: Option<std::collections::HashMap<String, GofileChild>>,
}

#[derive(Deserialize)]
struct GofileChild {
    id: String,
    #[serde(rename = "type")]
    child_type: String,
    link: Option<String>,
}

fn extract_content_id(url: &reqwest::Url) -> Option<String> {
    let parts: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
    if parts.len() >= 2 && parts[0] == "d" {
        return Some(parts[1].to_string());
    }
    None
}

async fn ensure_account_token() -> Result<String, HosterError> {
    {
        let guard = GOFILE_ACCOUNT_TOKEN
            .lock()
            .map_err(|_| HosterError::ResolutionFailed("gofile: mutex de token".into()))?;
        if let Some(ref t) = *guard {
            return Ok(t.clone());
        }
    }

    let website = generate_website_token("");
    let response = HOSTER_CLIENT
        .post("https://api.gofile.io/accounts")
        .header("X-Website-Token", website)
        .header("X-BL", GOFILE_LANGUAGE)
        .header("Origin", "https://gofile.io")
        .header("Referer", "https://gofile.io/")
        .header("Accept", "*/*")
        .header("Accept-Encoding", "gzip")
        .header("Connection", "keep-alive")
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(HosterError::Http(response.status().as_u16()));
    }

    let parsed: GofileAccountsEnvelope = response.json().await?;
    if parsed.status != "ok" {
        return Err(HosterError::ResolutionFailed(format!(
            "gofile: creación de cuenta: {}",
            parsed.status
        )));
    }
    let token = parsed
        .data
        .map(|d| d.token)
        .ok_or_else(|| HosterError::ResolutionFailed("gofile: sin token".into()))?;
    {
        let mut guard = GOFILE_ACCOUNT_TOKEN
            .lock()
            .map_err(|_| HosterError::ResolutionFailed("gofile: mutex de token".into()))?;
        *guard = Some(token.clone());
    }
    Ok(token)
}

async fn get_contents(
    id: &str,
    account_token: &str,
    password: Option<&str>,
) -> Result<GofileContentsBody, HosterError> {
    let mut q = String::from("cache=true&sortField=createTime&sortDirection=1");
    if let Some(p) = password {
        q.push_str("&password=");
        q.push_str(&urlencoding::encode(p));
    }

    let website = generate_website_token(account_token);
    let url = format!("https://api.gofile.io/contents/{id}?{q}");
    let response = HOSTER_CLIENT
        .get(&url)
        .header("Authorization", format!("Bearer {account_token}"))
        .header("X-Website-Token", website)
        .header("X-BL", GOFILE_LANGUAGE)
        .header("Origin", "https://gofile.io")
        .header("Referer", "https://gofile.io/")
        .header("Accept", "*/*")
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(HosterError::Http(response.status().as_u16()));
    }

    let envelope: GofileContentsEnvelope = response.json().await?;
    if envelope.status != "ok" {
        return Err(HosterError::ResolutionFailed(
            "gofile: no se pudo leer contenido".into(),
        ));
    }
    envelope
        .data
        .ok_or_else(|| HosterError::ResolutionFailed("gofile: cuerpo vacío".into()))
}

async fn parse_links_recursively(
    id: &str,
    account_token: &str,
    password: Option<&str>,
) -> Result<Option<String>, HosterError> {
    let data = get_contents(id, account_token, password).await?;

    if data.content_type == "file" {
        return Ok(data.link);
    }
    if data.content_type != "folder" {
        return Err(HosterError::ResolutionFailed(
            "gofile: tipo de contenido no soportado".into(),
        ));
    }

    let children: Vec<GofileChild> = data
        .children
        .map(|m| m.into_values().collect())
        .unwrap_or_default();

    for child in children {
        if child.child_type == "file" {
            if let Some(link) = child.link {
                return Ok(Some(link));
            }
        } else if child.child_type == "folder" {
            if let Some(nested) =
                Box::pin(parse_links_recursively(&child.id, account_token, password)).await?
            {
                return Ok(Some(nested));
            }
        }
    }
    Ok(None)
}

/// Resuelve la URL de descarga directa y el valor de cookie `accountToken` para el GET final.
pub async fn resolve(url: &str) -> Result<(String, String), HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let id = extract_content_id(&parsed)
        .ok_or_else(|| HosterError::ResolutionFailed("gofile: URL sin id /d/...".into()))?;

    let account_token = ensure_account_token().await?;
    let direct = parse_links_recursively(&id, &account_token, None)
        .await?
        .ok_or_else(|| HosterError::ResolutionFailed("gofile: sin enlaces de archivo".into()))?;

    Ok((direct, account_token))
}

#[cfg(test)]
mod tests {
    use sha2::Digest;

    use super::generate_website_token_at;

    #[test]
    fn website_token_matches_known_vector() {
        let token = generate_website_token_at("", 1);
        // accountToken vacío → `language::::timeSlot` (dos `::` seguidos).
        let raw = format!(
            "{}::en-US::::1::gf2026x",
            crate::network::HOSTER_BROWSER_USER_AGENT
        );
        let mut hasher = sha2::Sha256::new();
        hasher.update(raw.as_bytes());
        let expected = hex::encode(hasher.finalize());
        assert_eq!(token, expected);
    }
}
