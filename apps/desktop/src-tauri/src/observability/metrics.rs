//! Anillo de muestras HTTP (rutas /saves desde el cliente) y errores recientes.

use std::collections::VecDeque;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::Serialize;

const MAX_HTTP_SAMPLES: usize = 400;
const MAX_ERRORS: usize = 40;

#[derive(Clone, Debug)]
pub struct HttpSample {
    pub ts_ms: i64,
    pub duration_ms: u64,
    pub success: bool,
    #[allow(dead_code)]
    pub path: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEntry {
    pub ts_ms: i64,
    pub source: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
}

static HTTP_SAMPLES: Lazy<Mutex<VecDeque<HttpSample>>> = Lazy::new(|| Mutex::new(VecDeque::new()));

static ERROR_RING: Lazy<Mutex<VecDeque<ErrorEntry>>> = Lazy::new(|| Mutex::new(VecDeque::new()));

/// Registra tiempo de ida y vuelta de una llamada a la API de saves (p. ej. desde `api_request`).
pub fn record_saves_api_timing(duration_ms: u64, success: bool, path: &str) {
    let Ok(mut q) = HTTP_SAMPLES.lock() else {
        return;
    };
    let ts_ms = chrono::Utc::now().timestamp_millis();
    while q.len() >= MAX_HTTP_SAMPLES {
        q.pop_front();
    }
    q.push_back(HttpSample {
        ts_ms,
        duration_ms,
        success,
        path: path.to_string(),
    });
}

/// Error estructurado para el panel (sync, red, etc.).
pub fn record_error(source: &str, message: &str, status_code: Option<u16>) {
    let Ok(mut q) = ERROR_RING.lock() else {
        return;
    };
    let ts_ms = chrono::Utc::now().timestamp_millis();
    while q.len() >= MAX_ERRORS {
        q.pop_front();
    }
    q.push_back(ErrorEntry {
        ts_ms,
        source: source.to_string(),
        message: message.chars().take(500).collect(),
        status_code,
    });
}

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SavesApiSummary {
    pub sample_count: usize,
    pub error_count: usize,
    pub p50_ms: Option<u64>,
    pub p95_ms: Option<u64>,
}

pub fn summarize_http_window(window_ms: i64) -> SavesApiSummary {
    let cutoff = chrono::Utc::now().timestamp_millis() - window_ms;
    let Ok(q) = HTTP_SAMPLES.lock() else {
        return SavesApiSummary::default();
    };
    let samples: Vec<&HttpSample> = q.iter().filter(|s| s.ts_ms >= cutoff).collect();
    let n = samples.len();
    let err_n = samples.iter().filter(|s| !s.success).count();
    let mut durations: Vec<u64> = samples
        .iter()
        .filter(|s| s.success)
        .map(|s| s.duration_ms)
        .collect();
    durations.sort_unstable();
    SavesApiSummary {
        sample_count: n,
        error_count: err_n,
        p50_ms: percentile(&durations, 0.50),
        p95_ms: percentile(&durations, 0.95),
    }
}

pub fn recent_errors_window(window_ms: i64, limit: usize) -> Vec<ErrorEntry> {
    let cutoff = chrono::Utc::now().timestamp_millis() - window_ms;
    let Ok(q) = ERROR_RING.lock() else {
        return vec![];
    };
    q.iter()
        .rev()
        .filter(|e| e.ts_ms >= cutoff)
        .take(limit)
        .cloned()
        .collect()
}

/// Percentil sobre slice ordenado ascendente (rank nearest).
pub fn percentile(sorted: &[u64], p: f64) -> Option<u64> {
    if sorted.is_empty() {
        return None;
    }
    if sorted.len() == 1 {
        return Some(sorted[0]);
    }
    let rank = (p * (sorted.len() - 1) as f64).round() as usize;
    let idx = rank.clamp(0, sorted.len() - 1);
    Some(sorted[idx])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentile_basic() {
        let v = vec![10u64, 20, 30, 40, 100];
        assert_eq!(percentile(&v, 0.0), Some(10));
        assert_eq!(percentile(&v, 1.0), Some(100));
        assert_eq!(percentile(&v, 0.5), Some(30));
    }
}
