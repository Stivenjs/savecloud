//! Detección preventiva de respuestas web erróneas (HTML, JSON de error, Cloudflare CAPTCHAs)
//! y formateo de mensajes de error de red.

use std::time::Duration;
use reqwest::header::HeaderMap;

use crate::sources::hosters;

/// Comprueba si la cabecera `Content-Type` indica contenido web (HTML o JSON) en lugar de binario.
pub fn response_is_html_or_json(headers: &HeaderMap) -> bool {
    let content_type = headers
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    content_type.contains("text/html") || content_type.contains("application/json")
}

/// Analiza los primeros bytes recibidos de la descarga para verificar si corresponden a una
/// página web (HTML/XML/JSON) en lugar de un archivo binario comprimido (.rar, .zip, etc.).
pub fn looks_like_html_or_json(chunk: &[u8]) -> bool {
    let preview = String::from_utf8_lossy(&chunk[..chunk.len().min(128)]);
    let trimmed = preview.trim_start();
    trimmed.starts_with("<!DOCTYPE")
        || trimmed.starts_with("<html")
        || trimmed.starts_with("<?xml")
        || trimmed.starts_with('{')
        || trimmed.starts_with('[')
}

/// Identifica si el texto de vista previa contiene patrones conocidos de desafío Cloudflare o CAPTCHA.
pub fn looks_like_cloudflare_challenge(preview: &str) -> bool {
    let lower = preview.to_ascii_lowercase();
    lower.contains("cloudflare")
        || lower.contains("cf-turnstile")
        || lower.contains("challenge-platform")
        || lower.contains("cdn-cgi/challenge")
        || lower.contains("just a moment")
        || lower.contains("attention required")
}

/// Formatea un mensaje de error amigable cuando el archivo recibido no es un instalador legítimo.
pub fn invalid_download_body_message(uri: &str, preview: Option<&str>) -> String {
    let lower = uri.to_ascii_lowercase();
    let is_viking = lower.contains("vikingfile") || lower.contains("vik1ngfile");
    let cf = preview.is_some_and(looks_like_cloudflare_challenge);

    if is_viking || cf {
        return "VikingFile devolvió una página de protección (Cloudflare/CAPTCHA), no el instalador. Abre el enlace en el navegador, completa la verificación y descarga manualmente.".into();
    }

    if lower.contains("gofile.io") {
        return hosters::error::gofile_html_instead_of_json();
    }

    "El enlace no devolvió un archivo válido (página web en lugar del instalador)".into()
}

/// Formatea un mensaje de error detallado cuando se produce un corte en el stream de red.
pub fn stream_read_error_message(
    err: reqwest::Error,
    loaded: u64,
    total: u64,
    elapsed: Duration,
) -> String {
    if err.is_timeout() {
        return format!(
            "La descarga se cortó por inactividad de red ({loaded} de {total} bytes tras {} s)",
            elapsed.as_secs()
        );
    }
    format!("Error leyendo stream HTTP: {err}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn looks_like_html_or_json_detects_html_and_json() {
        assert!(looks_like_html_or_json(b"<!DOCTYPE html><html><body>Error</body></html>"));
        assert!(looks_like_html_or_json(b"  <html><head><title>Just a moment</title></head></html>"));
        assert!(looks_like_html_or_json(b"{\"status\": \"error\", \"message\": \"invalid\"}"));
        assert!(!looks_like_html_or_json(b"Rar!\x1a\x07\x00BinaryDataArchiveContentHere"));
        assert!(!looks_like_html_or_json(b"PK\x03\x04ZipFileHeaderBinaryContent"));
    }

    #[test]
    fn looks_like_cloudflare_challenge_detects_keywords() {
        assert!(looks_like_cloudflare_challenge("Just a moment... Please verify"));
        assert!(looks_like_cloudflare_challenge("Attention Required! | Cloudflare"));
        assert!(!looks_like_cloudflare_challenge("Normal game installer content"));
    }
}
