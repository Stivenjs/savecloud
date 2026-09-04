//! Extracción y sanitización de nombres de archivo a partir de cabeceras HTTP y URLs.
//!
//! Soporta especificaciones RFC 5987 y RFC 6266 (`Content-Disposition: filename*=UTF-8''...`),
//! decodificación percent-encoding y resolución de nombres únicos con slugify.

use std::path::Path;
use reqwest::header::HeaderMap;

use crate::sources::parser::slugify;

/// Obtiene el nombre del archivo desde la cabecera `Content-Disposition`.
///
/// Prioriza el parámetro codificado `filename*=` (RFC 5987 / RFC 6266) por sobre
/// el parámetro `filename=` básico en texto plano.
pub fn content_disposition_filename(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get("content-disposition")?.to_str().ok()?;
    let mut plain = None;
    let mut encoded = None;

    for part in raw.split(';').map(str::trim) {
        let lower = part.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("filename*=") {
            let value = &part[part.len() - rest.len()..];
            if let Some(name) = parse_rfc5987_filename(value) {
                encoded = Some(name);
            }
        } else if let Some(rest) = lower.strip_prefix("filename=") {
            let name = part[part.len() - rest.len()..]
                .trim()
                .trim_matches('"')
                .to_string();
            if !name.is_empty() {
                plain = Some(name);
            }
        }
    }

    encoded.or(plain)
}

/// Parsea y decodifica un valor con formato `charset'language'url_encoded_value` (RFC 5987).
pub fn parse_rfc5987_filename(value: &str) -> Option<String> {
    let encoded = value.split('\'').nth(2)?.trim().trim_matches('"');
    if encoded.is_empty() {
        return None;
    }
    let decoded = urlencoding::decode(encoded)
        .map(|c| c.into_owned())
        .unwrap_or_else(|_| encoded.to_string());
    if decoded.is_empty() {
        None
    } else {
        Some(decoded)
    }
}

/// Construye el nombre de archivo de destino final basado en el título del juego,
/// la URL efectiva y el nombre sugerido por las cabeceras del servidor.
pub fn build_output_name(title: &str, uri: &str, hint: Option<&str>) -> String {
    if let Some(name) = hint {
        let safe = Path::new(name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(name);
        if safe.contains('.') {
            return format!("{}-{}", slugify(title), safe);
        }
    }

    let extension = reqwest::Url::parse(uri)
        .ok()
        .and_then(|url| {
            Path::new(url.path())
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|v| v.to_ascii_lowercase())
        })
        .filter(|ext| !ext.is_empty() && ext.len() <= 8)
        .unwrap_or_else(|| "bin".to_string());
    format!("{}.{}", slugify(title), extension)
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::header::{HeaderMap, HeaderValue};

    #[test]
    fn content_disposition_prefers_rfc5987_filename() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "content-disposition",
            HeaderValue::from_static(
                "attachment; filename=\"fallback.zip\"; filename*=UTF-8''encoded%20name.zip",
            ),
        );
        assert_eq!(
            content_disposition_filename(&headers).as_deref(),
            Some("encoded name.zip")
        );
    }

    #[test]
    fn parse_rfc5987_filename_handles_valid_and_invalid() {
        assert_eq!(
            parse_rfc5987_filename("UTF-8''game%20archive.rar").as_deref(),
            Some("game archive.rar")
        );
        assert_eq!(parse_rfc5987_filename("invalid_format"), None);
    }

    #[test]
    fn build_output_name_uses_disposition_hint() {
        let name = build_output_name(
            "Sons Of The Forest",
            "https://cdn.example/download/abc?sig=1",
            Some("Sons Of The Forest - SteamGG.NET.zip"),
        );
        assert!(name.ends_with("Sons Of The Forest - SteamGG.NET.zip"));
        assert!(!name.ends_with(".bin"));
    }

    #[test]
    fn build_output_name_falls_back_to_url_extension() {
        let name = build_output_name(
            "Portal 2",
            "https://server.com/files/download.rar?token=xyz",
            None,
        );
        assert_eq!(name, "portal-2.rar");
    }
}
