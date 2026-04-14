//! Mediafire: página HTML + regex 

use once_cell::sync::Lazy;
use regex::Regex;

use crate::network::HOSTER_CLIENT;

use super::error::HosterError;

static VALID_MEDIAFIRE_IDENTIFIER_DL: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^[a-zA-Z0-9]+$").expect("regex mediafire id"));

static VALID_MEDIAFIRE_PRE_DL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?:(?:https?:)?//)?(?:www\.)?mediafire\.com/(?:file|view|download)/[^'"?]+\?[^"']*dkey=[^"']+"#)
        .expect("regex mediafire predl")
});

static VALID_DYNAMIC_DL: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"https?://download\d+\.mediafire\.com/[^"']+"#).expect("regex mediafire dynamic")
});

fn process_url(url: &str) -> String {
    let mut processed = url.replace("http://", "https://");

    if VALID_MEDIAFIRE_IDENTIFIER_DL.is_match(processed.trim()) {
        processed = format!("https://mediafire.com/?{processed}");
    }

    if !processed.starts_with("http://") && !processed.starts_with("https://") {
        processed = if processed.starts_with("//") {
            format!("https:{processed}")
        } else {
            format!("https://{processed}")
        };
    }

    processed
}

fn extract_direct_url(html: &str) -> Result<String, HosterError> {
    if let Some(m) = VALID_MEDIAFIRE_PRE_DL.find(html) {
        return Ok(m.as_str().to_string());
    }
    if let Some(m) = VALID_DYNAMIC_DL.find(html) {
        return Ok(m.as_str().to_string());
    }
    Err(HosterError::ResolutionFailed(
        "mediafire: no se encontró enlace directo".into(),
    ))
}

pub async fn resolve(url: &str) -> Result<String, HosterError> {
    let processed = process_url(url);
    let response = HOSTER_CLIENT.get(&processed).send().await?;
    if !response.status().is_success() {
        return Err(HosterError::Http(response.status().as_u16()));
    }
    let html = response.text().await?;
    extract_direct_url(&html)
}

#[cfg(test)]
mod tests {
    use super::extract_direct_url;

    #[test]
    fn fixture_extracts_pre_or_dynamic() {
        let html = r#"var x = "https://www.mediafire.com/file/abc123/foo.zip?dkey=deadbeef";"#;
        let u = extract_direct_url(html).expect("pre");
        assert!(u.contains("mediafire.com/file/"));

        let html2 = r#"href="https://download42.mediafire.com/xyz/file.zip""#;
        let u2 = extract_direct_url(html2).expect("dynamic");
        assert!(u2.contains("download"));
    }
}
