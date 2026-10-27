//! Política común de reintentos para transferencias HTTP.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use reqwest::header::HeaderMap;

/// Calcula espera exponencial con jitter y respeta `Retry-After` si el servidor lo envía.
pub fn retry_delay(retry: usize, headers: Option<&HeaderMap>) -> Duration {
    let base_ms = 500_u64.saturating_mul(1_u64 << retry.min(4));
    let jitter_ms = if base_ms > 1 {
        rand::random::<u64>() % (base_ms / 4 + 1)
    } else {
        0
    };
    let backoff = Duration::from_millis(base_ms + jitter_ms);

    headers
        .and_then(parse_retry_after)
        .map_or(backoff, |server_delay| server_delay.max(backoff))
}

/// Espera antes de reintentar y permite que pausa o cancelación interrumpan la espera.
pub async fn wait_for_retry(
    delay: Duration,
    cancel_flag: &Arc<AtomicBool>,
    pause_flag: &Arc<AtomicBool>,
) -> Result<(), String> {
    let sleep = tokio::time::sleep(delay);
    tokio::pin!(sleep);

    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("stopped_by_user".to_string());
        }
        if pause_flag.load(Ordering::Relaxed) {
            return Err("paused_by_user".to_string());
        }

        tokio::select! {
            _ = &mut sleep => return Ok(()),
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }
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
    let now = chrono::Utc::now();
    let delay = retry_at.signed_duration_since(now);
    Some(delay.to_std().ok()?)
}
