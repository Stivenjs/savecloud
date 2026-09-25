//! Token de cancelación por subsistema con seguimiento de finalización.
//!
//! Cada subsistema que realiza operaciones de larga duración (subidas, descargas,
//! empaquetado) obtiene un [`ShutdownGuard`] al iniciar su trabajo. El guard
//! cumple dos funciones:
//!
//! 1. **Señal de cancelación**: expone el [`CancellationToken`] para que la tarea
//!    pueda interrumpirse limpiamente cuando el bus dispare el shutdown.
//! 2. **Barrera de sincronización**: usa un [`tokio::sync::watch`] para que el
//!    [`ShutdownCoordinator`] pueda esperar a que cada subsistema confirme que
//!    terminó antes de dejar que el proceso salga.
//!
//! # Ciclo de vida
//!
//! ```text
//! ShutdownBus::new_guard(name) ──► ShutdownGuard (activo)
//!         │
//!         ├─► guard.token() ──► CancellationToken (compartido con el subsistema)
//!         │
//!         ├─► ShutdownBus dispara ──► token se cancela ──► subsistema lo detecta
//!         │
//!         └─► subsistema termina ──► guard.complete() ──► coordinator desbloquea
//! ```
//!
//! # Uso en subsistemas
//!
//! ```rust,no_run
//! // Al iniciar:
//! let guard = shutdown_bus.new_guard("multipart_upload");
//! let token = guard.token();
//!
//! // En el bucle de trabajo:
//! loop {
//!     tokio::select! {
//!         _ = token.cancelled() => {
//!             // Abortar multipart en S3, liberar recursos
//!             break;
//!         }
//!         chunk = rx.recv() => {
//!             // procesar chunk...
//!         }
//!     }
//! }
//!
//! // Al finalizar (limpio o por cancelación):
//! guard.complete();
//! ```

use std::sync::Arc;

use tokio::sync::watch;
use tokio_util::sync::CancellationToken;

/// Estado de completitud de un subsistema, enviado a través del canal watch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CompletionState {
    /// El subsistema aún está ejecutándose.
    Running,
    /// El subsistema terminó limpiamente (éxito o cancelación ordenada).
    Completed,
    /// El subsistema terminó con un error que se incluye como descripción.
    Failed(String),
}

/// Datos internos compartidos entre el guard y el handle de espera.
struct GuardInner {
    /// Nombre descriptivo del subsistema para logs y diagnóstico.
    name: String,

    /// Token de cancelación hijo del token del bus global. Cancelar el padre
    /// automáticamente cancela este token (propagación en cascada).
    token: CancellationToken,

    /// Canal watch para notificar la finalización al coordinador.
    /// El watch es preferible a un oneshot porque permite múltiples lectores
    /// y no consume el receptor al leerlo.
    completion_tx: watch::Sender<CompletionState>,
}

/// Token de cancelación y barrera de finalización para un subsistema específico.
///
/// Cuando este guard es dropeado sin llamar a [`ShutdownGuard::complete`],
/// el destructor automáticamente marca el subsistema como completado para
/// evitar que el coordinador espere indefinidamente.
pub struct ShutdownGuard(Arc<GuardInner>);

/// Handle de solo-lectura que el coordinador usa para esperar la finalización.
///
/// Puede clonarse y compartirse libremente; no permite completar el guard.
#[derive(Clone)]
pub struct CompletionHandle {
    name: String,
    pub(crate) rx: watch::Receiver<CompletionState>,
}

impl ShutdownGuard {
    /// Crea un nuevo guard para un subsistema con el nombre dado.
    ///
    /// # Parámetros
    ///
    /// - `name`: nombre descriptivo del subsistema (para logs).
    /// - `parent_token`: token del bus global; este guard es hijo de él, de
    ///   modo que el cierre del bus propaga la cancelación automáticamente.
    ///
    /// # Retorna
    ///
    /// Una tupla `(ShutdownGuard, CompletionHandle)`:
    /// - El guard se entrega al subsistema.
    /// - El handle se entrega al coordinador para esperar la finalización.
    pub fn new(
        name: impl Into<String>,
        parent_token: &CancellationToken,
    ) -> (Self, CompletionHandle) {
        let name = name.into();

        // El token hijo es cancelado automáticamente cuando el padre se cancela.
        // Esto permite que el bus global propague la señal a todos los guards
        // sin necesidad de iterarlos manualmente.
        let token = parent_token.child_token();

        let (completion_tx, completion_rx) = watch::channel(CompletionState::Running);

        let inner = Arc::new(GuardInner {
            name: name.clone(),
            token,
            completion_tx,
        });

        let guard = ShutdownGuard(inner);
        let handle = CompletionHandle {
            name,
            rx: completion_rx,
        };

        (guard, handle)
    }

    /// Devuelve el token de cancelación para usar en `select!` o pasarlo a subtareas.
    ///
    /// El token se cancela automáticamente cuando el bus global dispara el shutdown.
    ///
    /// ```rust,no_run
    /// let token = guard.token();
    /// tokio::select! {
    ///     _ = token.cancelled() => { /* limpieza */ }
    ///     _ = do_work() => {}
    /// }
    /// ```
    pub fn token(&self) -> CancellationToken {
        self.0.token.clone()
    }

    /// Nombre del subsistema asociado a este guard.
    pub fn name(&self) -> &str {
        &self.0.name
    }

    /// Indica si la cancelación ya fue solicitada.
    ///
    /// Útil para chequeos sincrónicos en código blocking.
    pub fn is_cancelled(&self) -> bool {
        self.0.token.is_cancelled()
    }

    /// Marca el subsistema como terminado correctamente.
    ///
    /// Debe llamarse al final del trabajo, tanto en el camino de éxito como en
    /// el de cancelación limpia. El coordinador desbloqueará su espera al recibir
    /// este mensaje.
    ///
    /// Llamadas adicionales son no-ops seguros.
    pub fn complete(self) {
        // El send falla solo si todos los receptores fueron dropeados, lo cual
        // es aceptable (significa que el coordinador ya no espera).
        let _ = self.0.completion_tx.send(CompletionState::Completed);

        // Consumimos `self` para que el destructor no lo marque como completado
        // de nuevo, aunque sería inofensivo.
        // El drop natural ocurre al salir del scope.
    }

    /// Marca el subsistema como terminado con un error.
    ///
    /// El coordinador registrará el error pero continuará con las siguientes fases.
    pub fn fail(self, error: impl Into<String>) {
        let _ = self
            .0
            .completion_tx
            .send(CompletionState::Failed(error.into()));
    }
}

impl Drop for ShutdownGuard {
    /// Garantía de seguridad: si el guard es dropeado sin llamar a `complete` o
    /// `fail` (por ejemplo, por un panic), el coordinador no queda bloqueado.
    ///
    /// En este caso se marca como `Completed` para no bloquear el proceso.
    fn drop(&mut self) {
        // Solo enviar si el estado sigue siendo Running (no se llamó complete/fail).
        let current = self.0.completion_tx.borrow().clone();
        if current == CompletionState::Running {
            let _ = self.0.completion_tx.send(CompletionState::Completed);
        }
    }
}

impl CompletionHandle {
    /// Espera a que el subsistema asociado complete su trabajo.
    ///
    /// Retorna el estado final del subsistema. Nunca bloquea indefinidamente
    /// ya que el destructor de [`ShutdownGuard`] garantiza la finalización.
    pub async fn wait_for_completion(&mut self) -> CompletionState {
        // `changed()` retorna cuando el valor del watch cambia de `Running`
        // a cualquier otro estado. Si ya cambió antes de llamar aquí,
        // `changed()` retorna inmediatamente.
        loop {
            {
                let state = self.rx.borrow().clone();
                if state != CompletionState::Running {
                    return state;
                }
            }

            // Si el estado es Running, esperamos el próximo cambio.
            if self.rx.changed().await.is_err() {
                // El sender fue dropeado: el subsistema terminó (implícito).
                return CompletionState::Completed;
            }
        }
    }

    /// Nombre del subsistema que este handle monitorea.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Comprueba si el subsistema ya terminó sin bloquear.
    pub fn is_done(&self) -> bool {
        *self.rx.borrow() != CompletionState::Running
    }

    pub(crate) fn rx_clone(&self) -> tokio::sync::watch::Receiver<CompletionState> {
        self.rx.clone()
    }
}
