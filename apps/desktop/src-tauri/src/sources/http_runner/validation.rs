//! Detección preventiva de respuestas web erróneas (HTML, JSON de error, Cloudflare CAPTCHAs)
//! y formateo de mensajes de error de red.

use reqwest::header::HeaderMap;
use std::time::Duration;

use crate::sources::hosters;

/// Valida que una respuesta a `Range` contenga exactamente el tramo solicitado.
///
/// No basta con que la respuesta sea exitosa: `200 OK` significa que el servidor
/// ignoró el rango y no se puede anexar ni escribir como si fuera un `206`.
///
/// # Errors
///
/// Devuelve un error si el servidor no responde con `206 Partial Content`, omite
/// `Content-Range` o informa límites diferentes a los solicitados.
pub fn validate_partial_response(
    response: &reqwest::Response,
    expected_start: u64,
    expected_end: u64,
    expected_total: u64,
) -> Result<(), String> {
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "El servidor no respetó el rango HTTP solicitado (código {})",
            response.status()
        ));
    }

    let content_range = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Respuesta 206 sin cabecera Content-Range válida".to_string())?;
    let (actual_start, actual_end, actual_total) = parse_content_range(content_range)?;

    if (actual_start, actual_end, actual_total) != (expected_start, expected_end, expected_total) {
        return Err(format!(
            "El servidor devolvió un rango distinto al solicitado ({actual_start}-{actual_end}/{actual_total})"
        ));
    }

    Ok(())
}

/// Valida una respuesta de continuación cuando el tamaño remoto puede ser desconocido.
///
/// # Errors
///
/// Devuelve un error si la respuesta no es un rango parcial válido o si su inicio
/// o tamaño total no coincide con la continuación solicitada.
pub fn validate_resume_response(
    response: &reqwest::Response,
    expected_start: u64,
    expected_total: u64,
) -> Result<(), String> {
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err(format!(
            "El servidor no respetó la reanudación HTTP solicitada (código {})",
            response.status()
        ));
    }

    let content_range = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| "Respuesta 206 sin cabecera Content-Range válida".to_string())?;
    let (actual_start, actual_end, actual_total) = parse_content_range(content_range)?;
    if actual_start != expected_start
        || actual_end != actual_total - 1
        || (expected_total > 0 && actual_total != expected_total)
    {
        return Err(format!(
            "El servidor devolvió un rango de reanudación incoherente ({actual_start}-{actual_end}/{actual_total})"
        ));
    }

    Ok(())
}

fn parse_content_range(value: &str) -> Result<(u64, u64, u64), String> {
    let range = value
        .strip_prefix("bytes ")
        .ok_or_else(|| "Cabecera Content-Range con unidad inválida".to_string())?;
    let (range, total) = range
        .split_once('/')
        .ok_or_else(|| "Cabecera Content-Range incompleta".to_string())?;
    let (start, end) = range
        .split_once('-')
        .ok_or_else(|| "Cabecera Content-Range incompleta".to_string())?;

    let start = start
        .parse::<u64>()
        .map_err(|_| "Inicio inválido en Content-Range".to_string())?;
    let end = end
        .parse::<u64>()
        .map_err(|_| "Fin inválido en Content-Range".to_string())?;
    let total = total
        .parse::<u64>()
        .map_err(|_| "Tamaño total inválido en Content-Range".to_string())?;

    if end < start || total == 0 || end >= total {
        return Err("Content-Range contiene límites incoherentes".to_string());
    }

    Ok((start, end, total))
}

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
        assert!(looks_like_html_or_json(
            b"<!DOCTYPE html><html><body>Error</body></html>"
        ));
        assert!(looks_like_html_or_json(
            b"  <html><head><title>Just a moment</title></head></html>"
        ));
        assert!(looks_like_html_or_json(
            b"{\"status\": \"error\", \"message\": \"invalid\"}"
        ));
        assert!(!looks_like_html_or_json(
            b"Rar!\x1a\x07\x00BinaryDataArchiveContentHere"
        ));
        assert!(!looks_like_html_or_json(
            b"PK\x03\x04ZipFileHeaderBinaryContent"
        ));
    }

    #[test]
    fn looks_like_cloudflare_challenge_detects_keywords() {
        assert!(looks_like_cloudflare_challenge(
            "Just a moment... Please verify"
        ));
        assert!(looks_like_cloudflare_challenge(
            "Attention Required! | Cloudflare"
        ));
        assert!(!looks_like_cloudflare_challenge(
            "Normal game installer content"
        ));
    }
}
