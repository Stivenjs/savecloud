//! Estrategia de subida adaptativa para backups de juegos.
//!
//! Centraliza todas las decisiones de configuración del pipeline de subida:
//! tamaño de parte, concurrencia, capacidad del canal TAR, prefetch de URLs
//! y límite de memoria global en vuelo.
//!
//! # Diseño del `ConcurrencyController`
//!
//! - **Fase de calentamiento** (`WARMUP_PARTS`): descarta las primeras partes
//!   que corresponden al slow start de TCP, sin usarlas para ningún cálculo.
//! - **Ventana deslizante** (`WINDOW_SIZE`): mantiene solo las últimas N muestras
//!   para que el throughput calculado refleje las condiciones actuales de red,
//!   no las de cuando arrancó la subida.
//! - **Ajuste periódico bidireccional**: re-evalúa la concurrencia cada
//!   `ADJUST_INTERVAL` partes completadas, pudiendo subir o bajar según el
//!   throughput medido en la ventana actual.
//! - **Función de throughput centralizada**: `measured_throughput_mbps` es el
//!   único lugar donde se calcula el throughput; tanto el ajuste como el logging
//!   la llaman, eliminando la duplicación.
//!
//! # Límite de memoria global
//!
//! `UploadStrategy::max_inflight_bytes` calcula el techo de RAM que el pipeline
//! puede consumir simultáneamente. Este valor lo usa `upload_multipart.rs` para
//! decidir cuándo suspender la generación del TAR, evitando que el encoder llene
//! el buffer de partes más rápido de lo que la red las consume.

/// Tamaño mínimo de parte impuesto por la especificación de S3 (excepto la última parte).
const S3_MIN_PART_SIZE: usize = 5 * 1024 * 1024;

/// Tamaño máximo de parte permitido por S3.
const S3_MAX_PART_SIZE: usize = 5 * 1024 * 1024 * 1024;

/// Número mínimo de partes concurrentes.
const MIN_CONCURRENT_PARTS: usize = 2;

/// Número máximo de partes concurrentes.
/// Con partes de 64 MB y 16 slots el consumo en vuelo es ~1 GB, límite
/// razonable para equipos de escritorio sin restricción de RAM explícita.
const MAX_CONCURRENT_PARTS: usize = 16;

/// Tamaño de chunk emitido por el hilo TAR al canal.
/// Fijo en 2 MB; `UploadStrategy` calcula cuántos slots necesita el canal
/// para cubrir exactamente una parte completa.
const TAR_CHUNK_SIZE: usize = 2 * 1024 * 1024;

/// Número de URLs solicitadas en cada batch al API.
/// Debe coincidir con `PART_URL_BATCH` en `upload_multipart.rs`.
/// Se define aquí para que `prefetch_threshold` se calcule en términos del
/// mismo batch size, garantizando que el prefetch se dispare antes de que
/// el caché se agote.
const PART_URL_BATCH: u32 = 32;

/// Partes iniciales que se descartan para el cálculo de throughput.
///
/// Las primeras partes pagan el TCP slow start y el TLS handshake aunque el
/// pool de conexiones esté calentado. Descartarlas evita que el controller
/// infravalore el ancho de banda real y se quede en concurrencia baja.
const WARMUP_PARTS: usize = 3;

/// Tamaño de la ventana deslizante de muestras para el cálculo de throughput.
///
/// Mantener solo las últimas N muestras hace que el throughput calculado
/// refleje las condiciones actuales de red en vez del promedio histórico,
/// permitiendo que el controller reaccione a cambios en la conexión.
const WINDOW_SIZE: usize = 6;

/// Cada cuántas partes completadas se re-evalúa la concurrencia.
///
/// Un valor bajo (1-2) reacciona demasiado rápido al ruido de red.
/// Un valor alto (10+) responde tarde a cambios sostenidos.
/// 4 es un compromiso: responde a tendencias reales sin sobre-reaccionar.
const ADJUST_INTERVAL: usize = 4;

/// Umbral de throughput bajo (Mbps) por debajo del cual se reduce la concurrencia.
const THROUGHPUT_LOW_MBPS: f64 = 50.0;

/// Umbral de throughput alto (Mbps) por encima del cual se maximiza la concurrencia.
const THROUGHPUT_HIGH_MBPS: f64 = 200.0;

/// Parámetros de configuración calculados para una subida concreta.
///
/// Inmutable después de la construcción. El `ConcurrencyController` gestiona
/// el único aspecto dinámico (concurrencia actual) por separado.
#[derive(Debug, Clone)]
pub(crate) struct UploadStrategy {
    /// Tamaño en bytes de cada parte (excepto la última, que puede ser menor).
    pub part_size: usize,

    /// Número inicial de partes concurrentes antes de tener muestras de throughput.
    pub initial_concurrency: usize,

    /// Número total de partes estimado para este archivo.
    pub estimated_parts: u32,

    /// Capacidad del canal entre el hilo TAR y el consumidor multipart.
    /// Calculada para que el buffer en tránsito no supere una parte completa.
    pub tar_channel_capacity: usize,

    /// Cuántas URLs adelante del número de parte actual deben estar en caché
    /// antes de disparar el prefetch especulativo del siguiente batch.
    /// Siempre es al menos `PART_URL_BATCH / 2` para garantizar que el prefetch
    /// se dispara mientras aún queda medio batch disponible.
    pub prefetch_threshold: u32,

    /// Límite de bytes en vuelo simultáneamente (partes encoladas + en subida).
    /// Derivado de `part_size × MAX_CONCURRENT_PARTS` con un margen de seguridad.
    pub max_inflight_bytes: usize,
}

impl UploadStrategy {
    /// Calcula la estrategia óptima para un archivo de `total_bytes` bytes.
    ///
    /// Si `total_bytes` es cero devuelve una estrategia mínima válida que
    /// permite completar la subida vacía sin errores en el pipeline.
    pub fn for_file(total_bytes: u64) -> Self {
        if total_bytes == 0 {
            return Self::minimal();
        }

        let part_size = optimal_part_size(total_bytes);
        let estimated_parts = estimated_part_count(total_bytes, part_size);
        let initial_concurrency = initial_concurrency_for_part_size(part_size);
        let tar_channel_capacity = (part_size / TAR_CHUNK_SIZE).max(1);

        // El prefetch se dispara cuando el caché tiene menos de la mitad de un
        // batch por delante del número de parte actual. Esto garantiza que la
        // petición al API se lanza antes de que el caché se agote, sin pedir
        // URLs demasiado anticipadas que podrían expirar antes de usarse.
        let prefetch_threshold = (PART_URL_BATCH / 2).max(1);

        // Límite de memoria en vuelo: partes que ya están siendo subidas más las
        // que están encoladas esperando slot. Se usa un factor de 1.5× sobre la
        // concurrencia máxima para absorber el buffer del canal TAR sin sobrepasarlo.
        let max_inflight_bytes = (part_size as f64 * MAX_CONCURRENT_PARTS as f64 * 1.5) as usize;

        Self {
            part_size,
            initial_concurrency,
            estimated_parts,
            tar_channel_capacity,
            prefetch_threshold,
            max_inflight_bytes,
        }
    }

    /// Estrategia mínima para archivos vacíos o sin estimación disponible.
    fn minimal() -> Self {
        Self {
            part_size: S3_MIN_PART_SIZE,
            initial_concurrency: MIN_CONCURRENT_PARTS,
            estimated_parts: 1,
            tar_channel_capacity: 1,
            prefetch_threshold: PART_URL_BATCH / 2,
            max_inflight_bytes: S3_MIN_PART_SIZE * MAX_CONCURRENT_PARTS,
        }
    }

    /// Descripción legible para logging. No contiene estado dinámico.
    pub fn describe(&self) -> String {
        format!(
            "part_size={}MB initial_concurrency={} estimated_parts={} \
             channel_capacity={} max_inflight_mb={}",
            self.part_size / (1024 * 1024),
            self.initial_concurrency,
            self.estimated_parts,
            self.tar_channel_capacity,
            self.max_inflight_bytes / (1024 * 1024),
        )
    }
}

/// Calcula el tamaño de parte óptimo para mantener el número de partes
/// en un rango manejable independientemente del tamaño del archivo.
///
/// Los rangos están calibrados para backups de juegos:
///
///   <= 128 MB  →   5 MB  (~26 partes máximo, saves pequeños)
///   <= 1 GB    →   8 MB  (~128 partes)
///   <= 10 GB   →  16 MB  (~640 partes)
///   <= 50 GB   →  32 MB  (~1600 partes)
///   <= 200 GB  →  64 MB  (~3200 partes, Flight Simulator)
///   > 200 GB   → 128 MB  (límite práctico, máximo S3 es 5 GB/parte)
fn optimal_part_size(total_bytes: u64) -> usize {
    let size = match total_bytes {
        0..=134_217_728 => 5 * 1024 * 1024,
        ..=1_073_741_824 => 8 * 1024 * 1024,
        ..=10_737_418_240 => 16 * 1024 * 1024,
        ..=53_687_091_200 => 32 * 1024 * 1024,
        ..=214_748_364_800 => 64 * 1024 * 1024,
        _ => 128 * 1024 * 1024,
    };
    size.clamp(S3_MIN_PART_SIZE, S3_MAX_PART_SIZE)
}

/// Número de partes estimado para un archivo de `total_bytes` con partes de `part_size`.
fn estimated_part_count(total_bytes: u64, part_size: usize) -> u32 {
    ((total_bytes + part_size as u64 - 1) / part_size as u64).min(u32::MAX as u64) as u32
}

/// Concurrencia inicial conservadora basada en el tamaño de parte.
///
/// Arranca conservador porque las primeras partes pagan cold start y no
/// es útil saturar la red antes de tener mediciones reales. El
/// `ConcurrencyController` ajustará hacia arriba o abajo con datos reales.
fn initial_concurrency_for_part_size(part_size: usize) -> usize {
    let mb = part_size / (1024 * 1024);
    match mb {
        0..=8 => 3,
        9..=16 => 3,
        17..=32 => 3,
        33..=64 => 2,
        _ => 2,
    }
}

/// Determina la concurrencia óptima para un throughput de red estimado.
///
///   < 50 Mbps:   2 slots (conexión lenta, minimizar contención)
///   50–100 Mbps: 4 slots
///   100–200 Mbps: 8 slots
///   > 200 Mbps: 16 slots (maximizar throughput en red rápida)
fn concurrency_for_throughput(throughput_mbps: f64) -> usize {
    let c = if throughput_mbps < THROUGHPUT_LOW_MBPS {
        MIN_CONCURRENT_PARTS
    } else if throughput_mbps < 100.0 {
        4
    } else if throughput_mbps < THROUGHPUT_HIGH_MBPS {
        8
    } else {
        MAX_CONCURRENT_PARTS
    };
    c.clamp(MIN_CONCURRENT_PARTS, MAX_CONCURRENT_PARTS)
}

/// Controla la concurrencia de subida en tiempo de ejecución mediante una
/// ventana deslizante de muestras de throughput.
///
/// # Fases de operación
///
/// 1. **Calentamiento** (primeras `WARMUP_PARTS` partes): las muestras se
///    descartan silenciosamente. Estas partes pagan TCP slow start y TLS
///    handshake y no son representativas del throughput sostenido.
///
/// 2. **Medición activa**: las muestras se acumulan en una ventana deslizante
///    de `WINDOW_SIZE` entradas. Las muestras más antiguas se desplazan al
///    incorporar nuevas, por lo que el throughput calculado refleja siempre
///    las condiciones recientes de red.
///
/// 3. **Ajuste periódico bidireccional**: cada `ADJUST_INTERVAL` partes
///    completadas se recalcula la concurrencia óptima y se aplica tanto si
///    el nuevo valor es mayor como si es menor que el actual.
pub(crate) struct ConcurrencyController {
    /// Concurrencia actual recomendada para el pipeline de subida.
    current: usize,

    /// Número total de partes registradas (incluyendo las de calentamiento).
    total_recorded: usize,

    /// Ventana deslizante de muestras (bytes_enviados, milisegundos).
    /// Implementada como buffer circular con índice de escritura.
    window: [(u64, u128); WINDOW_SIZE],

    /// Índice de la próxima posición de escritura en el buffer circular.
    window_head: usize,

    /// Número de muestras válidas actualmente en la ventana (≤ WINDOW_SIZE).
    window_len: usize,

    /// Número de partes completadas desde el último ajuste de concurrencia.
    since_last_adjust: usize,
}

impl ConcurrencyController {
    /// Crea un nuevo controller con la concurrencia inicial de la estrategia.
    pub fn new(strategy: &UploadStrategy) -> Self {
        Self {
            current: strategy.initial_concurrency,
            total_recorded: 0,
            window: [(0, 0); WINDOW_SIZE],
            window_head: 0,
            window_len: 0,
            since_last_adjust: 0,
        }
    }

    /// Concurrencia actual recomendada.
    pub fn current(&self) -> usize {
        self.current
    }

    /// Registra una parte completada con su tamaño en bytes y tiempo en milisegundos.
    ///
    /// Las primeras `WARMUP_PARTS` partes se descartan sin actualizar la ventana.
    /// A partir de ahí, cada muestra válida se incorpora a la ventana deslizante
    /// y se evalúa si corresponde aplicar un ajuste de concurrencia.
    pub fn record_part(&mut self, bytes_sent: u64, elapsed_ms: u128) {
        self.total_recorded += 1;

        // Fase de calentamiento: descartar muestras contaminadas por cold start.
        if self.total_recorded <= WARMUP_PARTS {
            return;
        }

        // Solo incorporar muestras con tiempo positivo para evitar división por cero
        // y muestras de partes que se completaron instantáneamente (ej. vacías).
        if elapsed_ms == 0 {
            return;
        }

        // Insertar en el buffer circular sobreescribiendo la muestra más antigua.
        self.window[self.window_head] = (bytes_sent, elapsed_ms);
        self.window_head = (self.window_head + 1) % WINDOW_SIZE;
        if self.window_len < WINDOW_SIZE {
            self.window_len += 1;
        }

        self.since_last_adjust += 1;
        if self.since_last_adjust >= ADJUST_INTERVAL {
            self.since_last_adjust = 0;
            self.apply_adjustment();
        }
    }

    /// Calcula el throughput de red sostenido estimado a partir de la ventana actual.
    ///
    /// Suma el throughput individual de cada muestra (bytes/ms → Mbps) y multiplica
    /// por la concurrencia actual para obtener el throughput total estimado de la red.
    /// Esto asume que las tareas concurrentes comparten el ancho de banda disponible
    /// de forma equitativa, lo que es una aproximación razonable para S3.
    ///
    /// Devuelve `None` si la ventana no tiene muestras válidas.
    fn measured_throughput_mbps(&self) -> Option<f64> {
        if self.window_len == 0 {
            return None;
        }

        let sum: f64 = self.window[..self.window_len]
            .iter()
            .filter(|&&(_, ms)| ms > 0)
            .map(|&(bytes, ms)| (bytes as f64 * 8.0) / (ms as f64 / 1000.0) / 1_000_000.0)
            .sum();

        let avg_task_mbps = sum / self.window_len as f64;
        Some(avg_task_mbps * self.current as f64)
    }

    /// Recalcula y aplica la concurrencia óptima según el throughput actual.
    ///
    /// A diferencia de la implementación anterior, el ajuste es bidireccional:
    /// puede reducir la concurrencia si el throughput medido cae, lo que evita
    /// saturar conexiones que se han degradado durante la subida.
    fn apply_adjustment(&mut self) {
        if let Some(throughput_mbps) = self.measured_throughput_mbps() {
            let optimal = concurrency_for_throughput(throughput_mbps);
            // Aplicar siempre el valor óptimo, en ambas direcciones.
            // No se cancela ninguna tarea en vuelo al bajar la concurrencia:
            // simplemente no se lanzan nuevas tareas hasta que el JoinSet
            // drene lo suficiente para volver al nuevo límite.
            self.current = optimal;
        }
    }

    /// Descripción del estado actual del controller para logging.
    pub fn describe(&self) -> String {
        match self.measured_throughput_mbps() {
            Some(mbps) => format!(
                "concurrency={} throughput_mbps={:.1} samples={} warmup_remaining={}",
                self.current,
                mbps,
                self.window_len,
                WARMUP_PARTS.saturating_sub(self.total_recorded),
            ),
            None => format!(
                "concurrency={} (calentando, partes={}/{})",
                self.current, self.total_recorded, WARMUP_PARTS,
            ),
        }
    }
}

/// Tamaño de chunk que el hilo TAR emite al canal.
///
/// Constante pública porque `tar_stream.rs` la necesita en tiempo de compilación
/// para dimensionar el `ChannelWriter`. La capacidad del canal se calcula
/// dinámicamente en `UploadStrategy` a partir de este valor.
pub(crate) const TAR_STREAM_CHUNK_BYTES: usize = TAR_CHUNK_SIZE;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn part_size_within_s3_limits() {
        let sizes = [
            0u64,
            1,
            1024,
            128 * 1024 * 1024,
            10 * 1024 * 1024 * 1024,
            50 * 1024 * 1024 * 1024,
            200 * 1024 * 1024 * 1024,
            u64::MAX,
        ];
        for &s in &sizes {
            let ps = optimal_part_size(s);
            assert!(
                ps >= S3_MIN_PART_SIZE,
                "part_size {} < S3 min para archivo {}",
                ps,
                s
            );
            assert!(
                ps <= S3_MAX_PART_SIZE,
                "part_size {} > S3 max para archivo {}",
                ps,
                s
            );
        }
    }

    #[test]
    fn strategy_for_empty_file_is_valid() {
        let s = UploadStrategy::for_file(0);
        assert_eq!(s.estimated_parts, 1);
        assert!(s.part_size >= S3_MIN_PART_SIZE);
        assert!(s.max_inflight_bytes > 0);
    }

    #[test]
    fn prefetch_threshold_is_half_batch() {
        let s = UploadStrategy::for_file(512 * 1024 * 1024);
        assert_eq!(s.prefetch_threshold, PART_URL_BATCH / 2);
    }

    #[test]
    fn concurrency_increases_with_throughput() {
        assert!(concurrency_for_throughput(10.0) <= concurrency_for_throughput(300.0));
    }

    #[test]
    fn controller_discards_warmup_samples() {
        let strategy = UploadStrategy::for_file(512 * 1024 * 1024);
        let mut ctrl = ConcurrencyController::new(&strategy);
        // Registrar partes de calentamiento con throughput altísimo
        for _ in 0..WARMUP_PARTS {
            ctrl.record_part(64 * 1024 * 1024, 1);
        }
        // La ventana debe estar vacía: las muestras de calentamiento no se incorporan
        assert_eq!(
            ctrl.window_len, 0,
            "la ventana debe estar vacia durante el calentamiento"
        );
    }

    #[test]
    fn controller_adjusts_after_warmup() {
        let strategy = UploadStrategy::for_file(512 * 1024 * 1024);
        let mut ctrl = ConcurrencyController::new(&strategy);
        // Quemar el calentamiento
        for _ in 0..WARMUP_PARTS {
            ctrl.record_part(8 * 1024 * 1024, 100);
        }
        // Registrar suficientes muestras para disparar el ajuste (ADJUST_INTERVAL)
        for _ in 0..ADJUST_INTERVAL {
            // ~640 Mbps por tarea → debería subir la concurrencia
            ctrl.record_part(64 * 1024 * 1024, 800);
        }
        assert!(
            ctrl.current() > strategy.initial_concurrency,
            "la concurrencia deberia subir con throughput alto"
        );
    }

    #[test]
    fn controller_can_decrease_concurrency() {
        let strategy = UploadStrategy::for_file(512 * 1024 * 1024);
        let mut ctrl = ConcurrencyController::new(&strategy);

        // Quemar calentamiento
        for _ in 0..WARMUP_PARTS {
            ctrl.record_part(8 * 1024 * 1024, 100);
        }

        // Subir la concurrencia con throughput alto
        for _ in 0..ADJUST_INTERVAL {
            ctrl.record_part(64 * 1024 * 1024, 800);
        }

        let high = ctrl.current();

        // Simular degradación de red severa
        // de la ventana (WINDOW_SIZE = 6) y forzar un nuevo ajuste puro.
        for _ in 0..(ADJUST_INTERVAL * 2) {
            ctrl.record_part(8 * 1024 * 1024, 10_000); // ~6 Mbps
        }

        assert!(
            ctrl.current() < high,
            "la concurrencia deberia bajar con throughput bajo"
        );
    }

    #[test]
    fn describe_does_not_panic_without_samples() {
        let strategy = UploadStrategy::for_file(1024 * 1024 * 1024);
        let ctrl = ConcurrencyController::new(&strategy);
        let _ = ctrl.describe(); // no debe entrar en pánico
    }
}
