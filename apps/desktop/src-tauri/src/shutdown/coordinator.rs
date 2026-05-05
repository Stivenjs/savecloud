//! Coordinador de cierre en fases ordenadas con timeouts por fase.
//!
//! # Diseño
//!
//! El cierre de la aplicación se divide en fases secuenciales, cada una con
//! su propio timeout. Las fases están ordenadas de menor a mayor impacto:
//! primero se detienen las operaciones de entrada (watchers, UI), luego las
//! de procesamiento (empaquetado), luego las de red (subidas, descargas P2P).
//!
//! # Fases
//!
//! | Fase                | Subsistemas                              | Timeout  |
//! |---------------------|------------------------------------------|----------|
//! | `UiAndWatchers`     | file watchers, process check, tray       | 1.5s     |
//! | `BackgroundTasks`   | auto-sync, game exit sync                | 3.5s     |
//! | `NetworkUploads`    | multipart uploads, TAR streaming         | 10s      |
//! | `TorrentSession`    | librqbit session, P2P downloads        | 6.5s     |
//! | `Cleanup`           | logs, temp files, estado persistente     | 2s       |
//!
//! # Timeout de emergencia
//!
//! Si todas las fases superan su timeout y el proceso sigue vivo, el coordinador
//! dispara un `std::process::exit(0)` después de [`EMERGENCY_KILL_SECS`] segundos
//! (debe ser mayor que la suma de los timeouts por fase por si ningún subsistema responde).
//! Esto garantiza que la app nunca quede "zombie" en el administrador de tareas.
//!
//! # Uso
//!
//! ```rust,no_run
//! // En main.rs:
//! let coordinator = ShutdownCoordinator::new(shutdown_bus.clone());
//!
//! // Registrar subsistemas al iniciarlos:
//! let (guard, handle) = ShutdownGuard::new("multipart_upload", &bus.token());
//! coordinator.register(ShutdownPhase::NetworkUploads, handle).await;
//!
//! // Al cerrar (en el hook de Tauri):
//! coordinator.run_shutdown().await;
//! ```

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Mutex;

use super::bus::ShutdownBus;
use super::guard::{CompletionHandle, CompletionState};

/// Tiempo máximo de espera para todas las fases combinadas antes de matar el proceso.
///
/// Este es el último recurso: si después de este tiempo el proceso sigue vivo,
/// se fuerza la salida. Debe ser mayor que la suma de timeouts de todas las fases.
const EMERGENCY_KILL_SECS: u64 = 36;

/// Fases del cierre ordenadas de menor a mayor "peso" operacional.
///
/// El orden numérico determina la secuencia de ejecución. Las fases con número
/// menor se ejecutan primero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ShutdownPhase {
    /// Watchers de archivos, comprobación de procesos, estado del systray.
    /// Estos son rápidos y no tienen estado de red que limpiar.
    UiAndWatchers = 0,

    /// Tareas de sincronización automática en segundo plano (game_exit_sync, auto-sync).
    /// Deben terminar antes de las subidas de red para no generar nuevas operaciones.
    BackgroundTasks = 1,

    /// Subidas multipart a S3, streaming TAR+ZSTD. Son las más lentas y costosas.
    /// Se les da el timeout más largo porque una subida interrumpida a medias
    /// puede dejar un multipart incompleto en S3 (aunque el abort lo limpie).
    NetworkUploads = 2,

    /// Sesión de librqbit (BitTorrent P2P). Necesita tiempo para cerrar conexiones
    /// TCP y guardar el estado DHT persistente en disco.
    TorrentSession = 3,

    /// Limpieza final: flush de logs, archivos temporales, estado de la app.
    /// Siempre se ejecuta aunque fases anteriores fallen.
    Cleanup = 4,
}

impl ShutdownPhase {
    /// Timeout máximo que se espera para que todos los subsistemas de esta fase terminen.
    pub fn timeout(&self) -> Duration {
        match self {
            // Límites por fase: si un subsistema se cuelga, no bloqueamos el cierre tanto tiempo.
            // Las fases igualmente terminan antes si todos los guards completan antes del timeout.
            ShutdownPhase::UiAndWatchers => Duration::from_millis(1500),
            ShutdownPhase::BackgroundTasks => Duration::from_millis(3500),
            ShutdownPhase::NetworkUploads => Duration::from_secs(10),
            ShutdownPhase::TorrentSession => Duration::from_millis(6500),
            ShutdownPhase::Cleanup => Duration::from_secs(2),
        }
    }

    /// Nombre legible para logs.
    pub fn name(&self) -> &'static str {
        match self {
            ShutdownPhase::UiAndWatchers => "UiAndWatchers",
            ShutdownPhase::BackgroundTasks => "BackgroundTasks",
            ShutdownPhase::NetworkUploads => "NetworkUploads",
            ShutdownPhase::TorrentSession => "TorrentSession",
            ShutdownPhase::Cleanup => "Cleanup",
        }
    }

    /// Todas las fases en orden de ejecución.
    pub fn all_ordered() -> [ShutdownPhase; 5] {
        [
            ShutdownPhase::UiAndWatchers,
            ShutdownPhase::BackgroundTasks,
            ShutdownPhase::NetworkUploads,
            ShutdownPhase::TorrentSession,
            ShutdownPhase::Cleanup,
        ]
    }
}

/// Registro interno: mapea cada fase a la lista de handles de subsistemas registrados.
type PhaseRegistry = HashMap<ShutdownPhase, Vec<CompletionHandle>>;

/// Orquesta el cierre en fases ordenadas con timeouts por fase.
///
/// Debe crearse una sola vez en `main.rs` y compartirse (via `Arc` o estado de Tauri)
/// con todos los subsistemas que necesiten registrarse.
#[derive(Clone)]
pub struct ShutdownCoordinator {
    bus: ShutdownBus,
    registry: Arc<Mutex<PhaseRegistry>>,
}

impl ShutdownCoordinator {
    /// Crea un nuevo coordinador asociado al bus de shutdown dado.
    pub fn new(bus: ShutdownBus) -> Self {
        Self {
            bus,
            registry: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Registra un handle de subsistema en una fase específica del cierre.
    ///
    /// El coordinador esperará a este subsistema durante la fase indicada.
    /// Debe llamarse **antes** de que el subsistema inicie su trabajo.
    ///
    /// # Parámetros
    ///
    /// - `phase`: fase en la que este subsistema debe terminar.
    /// - `handle`: handle de completitud obtenido de [`ShutdownGuard::new`].
    pub async fn register(&self, phase: ShutdownPhase, handle: CompletionHandle) {
        let mut reg = self.registry.lock().await;
        reg.entry(phase).or_default().push(handle);
    }

    /// Ejecuta el cierre completo en fases ordenadas.
    ///
    /// Este método:
    /// 1. Dispara la señal de cierre en el bus (cancela todos los tokens).
    /// 2. Itera las fases en orden, esperando que cada subsistema termine.
    /// 3. Si una fase excede su timeout, registra el error y avanza a la siguiente.
    /// 4. Lanza un timer de emergencia que mata el proceso si todo lo anterior falla.
    ///
    /// # Seguridad
    ///
    /// Este método solo debe llamarse una vez. El `ShutdownBus::trigger` es
    /// idempotente, así que llamadas adicionales son seguras pero innecesarias.
    pub async fn run_shutdown(&self) {
        log::info!("[Shutdown] Iniciando cierre seguro de la aplicación...");

        // Lanzar el timer de emergencia ANTES de disparar el shutdown.
        // Si algo va muy mal (deadlock, hilo blocking colgado), este timer
        // garantiza que el proceso muere en EMERGENCY_KILL_SECS segundos.
        tokio::spawn(async {
            tokio::time::sleep(Duration::from_secs(EMERGENCY_KILL_SECS)).await;
            log::error!(
                "[Shutdown] EMERGENCIA: timeout de {} segundos alcanzado. Forzando salida.",
                EMERGENCY_KILL_SECS
            );
            // `exit` es la última opción: garantiza la salida incluso con hilos colgados.
            // En un cierre normal nunca llegamos aquí.
            std::process::exit(0);
        });

        // Disparar la señal de cierre a todos los subsistemas.
        self.bus.trigger().await;
        log::info!("[Shutdown] Señal de cierre enviada a todos los subsistemas.");

        // Ejecutar las fases en orden.
        let phases = ShutdownPhase::all_ordered();
        for phase in &phases {
            self.run_phase(*phase).await;
        }

        log::info!("[Shutdown] Todas las fases completadas. Proceso listo para salir.");
    }

    /// Ejecuta una única fase del cierre.
    ///
    /// Espera a que todos los subsistemas registrados en esta fase completen,
    /// con el timeout de la fase. Los que no terminen a tiempo se reportan
    /// como error en el log pero no bloquean las fases siguientes.
    async fn run_phase(&self, phase: ShutdownPhase) {
        let handles = {
            let mut reg = self.registry.lock().await;
            reg.remove(&phase).unwrap_or_default()
        };

        if handles.is_empty() {
            log::debug!(
                "[Shutdown] Fase '{}': sin subsistemas registrados, omitiendo.",
                phase.name()
            );
            return;
        }

        log::info!(
            "[Shutdown] Fase '{}': esperando {} subsistema(s)...",
            phase.name(),
            handles.len()
        );

        let timeout = phase.timeout();
        let phase_name = phase.name();

        // Esperar todos los subsistemas de esta fase concurrentemente.
        // Usamos tokio::time::timeout como envolvente del join de todos los futures.
        let wait_all = Self::wait_all_handles(handles, phase_name);

        match tokio::time::timeout(timeout, wait_all).await {
            Ok(results) => {
                for (name, state) in results {
                    match state {
                        CompletionState::Completed => {
                            log::info!("[Shutdown] '{}' terminó limpiamente.", name);
                        }
                        CompletionState::Failed(err) => {
                            log::warn!("[Shutdown] '{}' terminó con error: {}", name, err);
                        }
                        CompletionState::Running => {
                            // No debería ocurrir: wait_for_completion() solo retorna
                            // cuando el estado cambia de Running.
                            log::warn!("[Shutdown] '{}' reportó estado Running inesperado.", name);
                        }
                    }
                }
                log::info!("[Shutdown] Fase '{}' completada.", phase_name);
            }
            Err(_timeout) => {
                log::error!(
                    "[Shutdown] Fase '{}' excedió el timeout de {} ms. Continuando con la siguiente fase.",
                    phase_name,
                    timeout.as_millis()
                );
            }
        }
    }

    /// Espera concurrentemente a todos los handles de una fase.
    ///
    /// Retorna el vector de resultados `(nombre, estado)` de cada subsistema.
    /// El orden no está garantizado.
    ///
    /// # Diseño
    ///
    /// Consume el `Vec<CompletionHandle>` por valor para poder mover cada handle
    /// a su propia tarea del [`tokio::task::JoinSet`] sin conflictos de borrow.
    /// Clonar el `watch::Receiver` interno (`rx_clone`) es O(1): solo incrementa
    /// el refcount del canal, no copia el estado.
    async fn wait_all_handles(
        handles: Vec<CompletionHandle>,
        phase_name: &'static str,
    ) -> Vec<(String, CompletionState)> {
        let mut join_set = tokio::task::JoinSet::new();

        // Consumir el vector por valor: cada handle se mueve a su tarea.
        // `into_iter()` garantiza que no haya borrows pendientes del Vec
        // mientras el JoinSet tiene las tareas en vuelo.
        for handle in handles.into_iter() {
            let name = handle.name().to_string();

            // `rx_clone()` devuelve un `watch::Receiver` clonable en O(1).
            // El receiver clonado comparte el mismo canal que el original,
            // así que observa los mismos cambios de estado.
            let mut rx = handle.rx_clone();

            join_set.spawn(async move {
                loop {
                    // Leer el estado actual sin consumir el receiver.
                    {
                        let state = rx.borrow().clone();
                        if state != CompletionState::Running {
                            log::debug!(
                                "[Shutdown] Fase '{}': subsistema '{}' reportó {:?}",
                                phase_name,
                                name,
                                state
                            );
                            return (name, state);
                        }
                    }

                    // Esperar la próxima notificación de cambio.
                    // Si el sender fue dropeado (subsistema terminó sin llamar
                    // a complete/fail), `changed()` devuelve Err y lo tratamos
                    // como terminación limpia gracias al Drop impl de ShutdownGuard.
                    if rx.changed().await.is_err() {
                        log::debug!(
                            "[Shutdown] Fase '{}': subsistema '{}' terminó (sender dropeado).",
                            phase_name,
                            name
                        );
                        return (name, CompletionState::Completed);
                    }
                }
            });
        }

        // Recolectar todos los resultados. `join_next` retorna `None` cuando
        // el JoinSet está vacío, lo que ocurre cuando todas las tareas terminaron.
        let mut results = Vec::new();
        while let Some(result) = join_set.join_next().await {
            match result {
                Ok(pair) => results.push(pair),
                Err(join_err) => {
                    // Una tarea panicked. Registrar y continuar para no
                    // bloquear el shutdown por el fallo de un solo subsistema.
                    log::error!(
                        "[Shutdown] Tarea de espera falló con panic en fase '{}': {:?}",
                        phase_name,
                        join_err
                    );
                }
            }
        }
        results
    }
}
