//! Métricas de transferencia compartidas (velocidad EWMA, ETA).

use std::time::{Duration, Instant};

/// Peso de la muestra instantánea en el promedio exponencial (0..1).
/// Valor bajo para que la velocidad mostrada no salte en cada emisión IPC.
const EWMA_ALPHA: f64 = 0.15;

/// Intervalo mínimo entre muestras para actualizar el EWMA (evita ruido por dt muy pequeño).
const MIN_SAMPLE_INTERVAL: Duration = Duration::from_millis(50);

/// Intervalo mínimo entre cambios de velocidad/ETA expuestos a la UI.
const MIN_PUBLISH_INTERVAL: Duration = Duration::from_millis(750);

/// Máximo cambio de ETA por publicación (segundos), evita saltos bruscos.
const ETA_MAX_STEP_SECS: u64 = 15;

/// Estima el tiempo restante para completar una descarga, en segundos.
///
/// Devuelve `None` cuando la descarga ya está completa (`downloaded >= total`)
/// o cuando no hay medición de velocidad disponible (`speed_bytes == 0`).
///
/// La división se redondea **hacia arriba** para que el ETA mostrado nunca
/// caiga a cero mientras aún faltan bytes.
#[inline]
pub fn compute_eta(total: u64, downloaded: u64, speed_bytes: u64) -> Option<u64> {
    if speed_bytes == 0 || downloaded >= total {
        return None;
    }
    let remaining = total - downloaded;
    Some(remaining.saturating_add(speed_bytes - 1) / speed_bytes)
}

/// Muestra de velocidad y ETA en un instante de progreso.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TransferSample {
    pub download_speed_bytes: u64,
    pub eta_seconds: Option<u64>,
}

/// Rastreador de velocidad con EWMA sobre la tasa instantánea entre emisiones.
#[derive(Debug, Clone)]
pub struct TransferSpeedTracker {
    last_loaded: u64,
    last_at: Option<Instant>,
    ewma_bps: Option<f64>,
    has_baseline: bool,
    published_speed: u64,
    published_eta: Option<u64>,
    last_publish_at: Option<Instant>,
}

impl TransferSpeedTracker {
    pub fn new() -> Self {
        Self {
            last_loaded: 0,
            last_at: None,
            ewma_bps: None,
            has_baseline: false,
            published_speed: 0,
            published_eta: None,
            last_publish_at: None,
        }
    }

    /// Registra bytes descargados y devuelve velocidad suavizada + ETA opcional.
    ///
    /// Con `force_publish`, actualiza los valores expuestos aunque no haya pasado
    /// [`MIN_PUBLISH_INTERVAL`] (p. ej. al completar la descarga).
    pub fn record(&mut self, loaded: u64, total: u64, now: Instant) -> TransferSample {
        self.record_inner(loaded, total, now, false)
    }

    pub fn record_final(&mut self, loaded: u64, total: u64, now: Instant) -> TransferSample {
        self.record_inner(loaded, total, now, true)
    }

    fn record_inner(
        &mut self,
        loaded: u64,
        total: u64,
        now: Instant,
        force_publish: bool,
    ) -> TransferSample {
        if loaded == 0 {
            return self.sample_for(total, 0);
        }

        if !self.has_baseline {
            self.last_loaded = loaded;
            self.last_at = Some(now);
            self.has_baseline = true;
            return self.sample_for(total, 0);
        }

        let Some(last_at) = self.last_at else {
            self.last_loaded = loaded;
            self.last_at = Some(now);
            return self.sample_for(total, 0);
        };

        let dt = now.saturating_duration_since(last_at);
        if dt < MIN_SAMPLE_INTERVAL || loaded <= self.last_loaded {
            return self.sample_published();
        }

        let delta = (loaded - self.last_loaded) as f64;
        let instant_bps = delta / dt.as_secs_f64();

        self.ewma_bps = Some(match self.ewma_bps {
            Some(prev) => EWMA_ALPHA * instant_bps + (1.0 - EWMA_ALPHA) * prev,
            None => instant_bps,
        });

        self.last_loaded = loaded;
        self.last_at = Some(now);

        let raw_speed = self
            .ewma_bps
            .map(|v| v.round().max(0.0) as u64)
            .unwrap_or(0);
        self.maybe_publish(total, raw_speed, now, force_publish);
        self.sample_published()
    }

    fn maybe_publish(&mut self, total: u64, raw_speed: u64, now: Instant, force: bool) {
        let first_speed = self.published_speed == 0 && raw_speed > 0;
        let interval_ok = self.last_publish_at.is_none_or(|t| {
            now.saturating_duration_since(t) >= MIN_PUBLISH_INTERVAL
        });

        if !force && !first_speed && !interval_ok {
            return;
        }

        let speed = quantize_speed_bytes(raw_speed);
        let raw_eta = if total > 0 {
            compute_eta(total, self.last_loaded, speed)
        } else {
            None
        };
        let eta_seconds = smooth_eta(self.published_eta, raw_eta);

        self.published_speed = speed;
        self.published_eta = eta_seconds;
        self.last_publish_at = Some(now);
    }

    pub fn published_sample(&self) -> TransferSample {
        self.sample_published()
    }

    fn sample_published(&self) -> TransferSample {
        TransferSample {
            download_speed_bytes: self.published_speed,
            eta_seconds: self.published_eta,
        }
    }

    fn sample_for(&self, total: u64, speed: u64) -> TransferSample {
        let eta_seconds = if total > 0 {
            compute_eta(total, self.last_loaded, speed)
        } else {
            None
        };
        TransferSample {
            download_speed_bytes: speed,
            eta_seconds,
        }
    }
}

/// Redondea la velocidad a pasos gruesos para que la UI no parpadee entre decimales.
fn quantize_speed_bytes(bps: u64) -> u64 {
    const KB: u64 = 1024;
    if bps < 100 * KB {
        let step = 10 * KB;
        (bps / step) * step
    } else {
        let step = 100 * KB;
        (bps / step) * step
    }
}

/// Limita cuánto puede cambiar el ETA entre dos emisiones consecutivas.
fn smooth_eta(prev: Option<u64>, next: Option<u64>) -> Option<u64> {
    match (prev, next) {
        (Some(p), Some(n)) => {
            if n > p {
                Some(p.saturating_add((n - p).min(ETA_MAX_STEP_SECS)))
            } else {
                Some(p.saturating_sub((p - n).min(ETA_MAX_STEP_SECS)))
            }
        }
        (Some(p), None) => Some(p),
        (None, next) => next,
    }
}

impl Default for TransferSpeedTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compute_eta_returns_none_when_complete_or_no_speed() {
        assert_eq!(compute_eta(1000, 1000, 500), None);
        assert_eq!(compute_eta(1000, 0, 0), None);
    }

    #[test]
    fn compute_eta_rounds_up() {
        // 100 bytes left at 30 B/s -> ceil(100/30) = 4
        assert_eq!(compute_eta(1000, 900, 30), Some(4));
    }

    #[test]
    fn first_sample_has_zero_speed() {
        let mut tracker = TransferSpeedTracker::new();
        let t0 = Instant::now();
        let s = tracker.record(1024, 10_000, t0);
        assert_eq!(s.download_speed_bytes, 0);
        assert_eq!(s.eta_seconds, None);
    }

    #[test]
    fn smooth_eta_limits_large_jumps() {
        assert_eq!(smooth_eta(Some(100), Some(10)), Some(85));
        assert_eq!(smooth_eta(Some(10), Some(100)), Some(25));
        assert_eq!(smooth_eta(None, Some(42)), Some(42));
        assert_eq!(smooth_eta(Some(120), None), Some(120));
    }

    #[test]
    fn quantize_speed_bytes_rounds_to_steps() {
        assert_eq!(quantize_speed_bytes(1_234_567), 1_228_800);
        assert_eq!(quantize_speed_bytes(50_000), 40_960);
    }

    #[test]
    fn ewma_converges_toward_constant_rate() {
        let mut tracker = TransferSpeedTracker::new();
        let t0 = Instant::now();
        let chunk: u64 = 256 * 1024;
        let interval = Duration::from_millis(250);
        let expected_bps = chunk as f64 / interval.as_secs_f64();

        let mut loaded = 0_u64;
        let mut last_speed = 0_u64;
        for i in 0..20 {
            loaded = loaded.saturating_add(chunk);
            let now = t0 + interval * (i + 1);
            let s = tracker.record(loaded, 50_000_000, now);
            last_speed = s.download_speed_bytes;
        }

        let ratio = last_speed as f64 / expected_bps;
        assert!(
            (0.85..=1.15).contains(&ratio),
            "ewma should converge near constant rate; got {last_speed}, expected ~{}",
            expected_bps as u64
        );
    }
}
