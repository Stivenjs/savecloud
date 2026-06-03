//! Sesiones de transferencia LAN pendientes (token corto).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;

#[derive(Clone)]
pub struct PendingTransferSession {
    pub token: String,
    pub game_key: String,
    pub manifest_hash: String,
    pub expires_at: Instant,
}

static SESSIONS: Lazy<Mutex<HashMap<String, PendingTransferSession>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn register_transfer_session(session: PendingTransferSession) {
    if let Ok(mut guard) = SESSIONS.lock() {
        guard.retain(|_, s| s.expires_at > Instant::now());
        guard.insert(session.token.clone(), session);
    }
}

pub fn peek_valid_session(token: &str) -> Option<PendingTransferSession> {
    let guard = SESSIONS.lock().ok()?;
    let entry = guard.get(token)?.clone();
    if entry.expires_at <= Instant::now() {
        return None;
    }
    Some(entry)
}

pub fn session_ttl_from_iso(expires_at: &str) -> Duration {
    chrono::DateTime::parse_from_rfc3339(expires_at)
        .ok()
        .and_then(|dt| {
            let target = dt.with_timezone(&chrono::Utc);
            let now = chrono::Utc::now();
            target.signed_duration_since(now).to_std().ok()
        })
        .unwrap_or(Duration::from_secs(300))
}
