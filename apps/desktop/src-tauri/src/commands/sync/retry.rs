//! Política compartida para reintentos de llamadas de sincronización a Fastify.

use std::time::Duration;

use reqwest::header::HeaderMap;

const BASE_DELAY: Duration = Duration::from_millis(500);
const MAX_BACKOFF: Duration = Duration::from_secs(8);
const SERVER_DELAY_JITTER_MS: u64 = 250;

/// Calcula una espera exponencial aleatoria y respeta el mínimo de `Retry-After`.
///
/// `retry_index` comienza en cero para el primer reintento. Si el servidor envía
/// `Retry-After`, se añade una pequeña dispersión para evitar que los clientes
/// vuelvan todos exactamente al mismo tiempo.
pub(crate) fn retry_delay(retry_index: u32, headers: Option<&HeaderMap>) -> Duration {
    let exponent = retry_index.min(4);
    let backoff_cap = BASE_DELAY
        .saturating_mul(1_u32 << exponent)
        .min(MAX_BACKOFF);
    let backoff =
        Duration::from_millis(rand::random::<u64>() % (backoff_cap.as_millis() as u64 + 1));
    let server_delay = headers.and_then(parse_retry_after).unwrap_or_default();

    if server_delay.is_zero() {
        backoff
    } else {
        server_delay.max(backoff)
            + Duration::from_millis(rand::random::<u64>() % (SERVER_DELAY_JITTER_MS + 1))
    }
}

/// Espera la demora calculada por [`retry_delay`].
pub(crate) async fn wait_before_retry(retry_index: u32, headers: Option<&HeaderMap>) {
    tokio::time::sleep(retry_delay(retry_index, headers)).await;
}

/// Indica si el método y ruta son seguros para volver a ejecutar automáticamente.
///
/// Los `POST` de URLs firmadas solo consultan/generan credenciales de transferencia;
/// las mutaciones de estado quedan fuera para evitar duplicarlas tras un timeout.
#[allow(dead_code)]
pub(crate) fn is_safe_to_retry(method: &reqwest::Method, path: &str) -> bool {
    method == reqwest::Method::GET
        || method == reqwest::Method::HEAD
        || (method == reqwest::Method::POST
            && matches!(
                path,
                "/upload-urls" | "/download-urls" | "/download-url" | "/multipart/part-urls"
            ))
}

/// Indica si la respuesta representa una condición transitoria del servicio.
pub(crate) fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 408 | 429 | 500 | 502 | 503 | 504)
}

fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    let value = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim();

    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }

    let retry_at = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    let delay = retry_at.signed_duration_since(chrono::Utc::now());
    delay.to_std().ok()
}

#[cfg(test)]
mod tests {
    use reqwest::header::{HeaderMap, HeaderValue, RETRY_AFTER};

    use super::{is_retryable_status, is_safe_to_retry, retry_delay};

    #[test]
    fn retry_delay_should_stay_within_exponential_window() {
        let delay = retry_delay(1, None);

        assert!(delay <= std::time::Duration::from_secs(1));
    }

    #[test]
    fn retry_delay_should_never_precede_retry_after() {
        let mut headers = HeaderMap::new();
        headers.insert(RETRY_AFTER, HeaderValue::from_static("3"));

        assert!(retry_delay(0, Some(&headers)) >= std::time::Duration::from_secs(3));
    }

    #[test]
    fn retry_safety_should_exclude_mutating_endpoints() {
        assert!(!is_safe_to_retry(&reqwest::Method::POST, "/multipart/init"));
        assert!(!is_safe_to_retry(&reqwest::Method::POST, "/delete-game"));
    }

    #[test]
    fn retry_safety_should_include_read_only_post_endpoints() {
        assert!(is_safe_to_retry(&reqwest::Method::POST, "/upload-urls"));
        assert!(is_safe_to_retry(&reqwest::Method::POST, "/download-url"));
        assert!(is_safe_to_retry(
            &reqwest::Method::POST,
            "/multipart/part-urls"
        ));
    }

    #[test]
    fn retryable_status_should_only_include_transient_http_codes() {
        assert!(is_retryable_status(reqwest::StatusCode::TOO_MANY_REQUESTS));
        assert!(is_retryable_status(
            reqwest::StatusCode::SERVICE_UNAVAILABLE
        ));
        assert!(!is_retryable_status(reqwest::StatusCode::BAD_REQUEST));
        assert!(!is_retryable_status(reqwest::StatusCode::NOT_FOUND));
    }
}
