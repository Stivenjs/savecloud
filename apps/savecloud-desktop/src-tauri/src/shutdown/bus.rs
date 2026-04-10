//! Canal de broadcast que distribuye la señal de cierre a todos los suscriptores.
//!
//! [`ShutdownBus`] es el punto central del sistema: actúa como un megáfono que
//! emite una única señal de cierre que todos los subsistemas escuchan en paralelo.
//!
//! # Diseño
//!
//! Se basa en [`tokio::sync::broadcast`] con capacidad 1 porque el mensaje de
//! cierre es único e idempotente: no importa cuántas veces se envíe, el efecto
//! es el mismo. Los suscriptores que no lean el canal a tiempo simplemente lo
//! encontrarán lleno en su próxima lectura, lo cual está bien para nuestro caso.
//!
//! Adicionalmente se usa un [`tokio_util::sync::CancellationToken`] para
//! integrarse con el ecosistema de tokio-util y permitir patrones `select!` más
//! ergonómicos en los subsistemas que ya usan esa librería.
//!
//! # Thread-safety
//!
//! [`ShutdownBus`] implementa [`Clone`] a través del [`Arc`] interno, por lo que
//! puede distribuirse libremente entre hilos y tareas de Tokio sin coste.

use std::sync::Arc;

use tokio::sync::{broadcast, Mutex};
use tokio_util::sync::CancellationToken;

/// Capacidad del canal broadcast. Solo necesitamos uno: el mensaje de cierre.
const BROADCAST_CAPACITY: usize = 1;

/// Estado interno compartido del bus de shutdown.
struct BusInner {
    /// Emisor del canal broadcast. Protegido por Mutex para permitir que solo
    /// un llamador envíe la señal de cierre (evitar doble-send innecesario).
    sender: Mutex<broadcast::Sender<()>>,

    /// Token de cancelación compatible con tokio-util para subsistemas que
    /// prefieren el patrón `token.cancelled().await` sobre el broadcast.
    token: CancellationToken,

    /// Flag atómico que indica si ya se solicitó el cierre. Evita que múltiples
    /// llamadas a [`ShutdownBus::trigger`] tengan efectos duplicados.
    triggered: std::sync::atomic::AtomicBool,
}

/// Bus central de señales de cierre seguro de la aplicación.
///
/// Debe crearse una sola instancia en `main.rs` y registrarse como estado de Tauri.
/// Todos los subsistemas reciben un clon de este bus para suscribirse.
///
/// # Ejemplo
///
/// ```rust,no_run
/// let bus = ShutdownBus::new();
/// app.manage(bus.clone());
///
/// // En un subsistema:
/// let token = bus.token();
/// tokio::select! {
///     _ = token.cancelled() => { /* limpieza */ }
///     _ = do_work() => {}
/// }
/// ```
#[derive(Clone)]
pub struct ShutdownBus(Arc<BusInner>);

impl ShutdownBus {
    /// Crea un nuevo bus de shutdown. Llama esto una sola vez en `main.rs`.
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(BROADCAST_CAPACITY);
        Self(Arc::new(BusInner {
            sender: Mutex::new(sender),
            token: CancellationToken::new(),
            triggered: std::sync::atomic::AtomicBool::new(false),
        }))
    }

    /// Dispara la señal de cierre hacia todos los suscriptores.
    ///
    /// Idempotente: llamadas adicionales después de la primera no tienen efecto.
    /// Puede invocarse desde cualquier contexto async.
    pub async fn trigger(&self) {
        // Evitar doble disparo usando compare-and-swap atómico.
        let already = self.0.triggered.swap(true, std::sync::atomic::Ordering::SeqCst);
        if already {
            return;
        }

        // Cancelar el token para subsistemas que usan tokio-util.
        self.0.token.cancel();

        // Enviar en el broadcast para subsistemas que usan receivers explícitos.
        let sender = self.0.sender.lock().await;
        // El error de "no hay receptores" es esperado si nadie se suscribió todavía.
        let _ = sender.send(());
    }

    /// Devuelve un nuevo receptor del canal broadcast.
    ///
    /// Cada subsistema debe llamar a esto **antes** de iniciar su trabajo para
    /// asegurarse de no perderse la señal de cierre. Recibirá todos los mensajes
    /// enviados después de este punto.
    pub fn subscribe(&self) -> ShutdownReceiver {
        // `subscribe()` en broadcast::Sender crea un receptor que recibe
        // mensajes futuros. Como la capacidad es 1, si el cierre ya fue
        // disparado, el receptor estará "lagged" pero el token ya estará
        // cancelado, así que el subsistema lo detectará igualmente.
        let receiver = {
            // Necesitamos el sender para crear un subscriber, pero subscribe()
            // está en el sender. Usamos try_lock ya que este path no es crítico
            // en cuanto a contención.
            let sender = self.0.sender.try_lock();
            match sender {
                Ok(s) => s.subscribe(),
                Err(_) => {
                    // Si el lock está ocupado, creamos un canal temporal solo
                    // para entregar el receiver. El token siempre funciona como fallback.
                    let (tx, rx) = broadcast::channel(1);
                    // Si ya fue triggered, enviar inmediatamente para que el
                    // receiver no espere.
                    if self.0.triggered.load(std::sync::atomic::Ordering::SeqCst) {
                        let _ = tx.send(());
                    }
                    rx
                }
            }
        };
        ShutdownReceiver {
            rx: receiver,
            token: self.0.token.clone(),
        }
    }

    /// Devuelve el [`CancellationToken`] para uso directo en `select!`.
    ///
    /// Este es el método preferido para subsistemas que usan `tokio_util`.
    ///
    /// ```rust,no_run
    /// let token = bus.token();
    /// tokio::select! {
    ///     _ = token.cancelled() => break,
    ///     result = some_future => { /* manejar resultado */ }
    /// }
    /// ```
    pub fn token(&self) -> CancellationToken {
        self.0.token.clone()
    }

    /// Indica si el shutdown ya fue solicitado.
    ///
    /// Útil para chequeos sincrónicos en bucles que no usan `select!`.
    pub fn is_triggered(&self) -> bool {
        self.0.triggered.load(std::sync::atomic::Ordering::SeqCst)
    }
}

impl Default for ShutdownBus {
    fn default() -> Self {
        Self::new()
    }
}

/// Receptor de la señal de shutdown obtenido mediante [`ShutdownBus::subscribe`].
///
/// Combina un receptor broadcast con un token de cancelación para máxima
/// flexibilidad. Los subsistemas pueden usar cualquiera de los dos métodos
/// según su arquitectura interna.
pub struct ShutdownReceiver {
    /// Receptor del canal broadcast. Puede usarse con `rx.recv().await`.
    pub rx: broadcast::Receiver<()>,

    /// Token de cancelación. Puede usarse con `token.cancelled().await` en `select!`.
    pub token: CancellationToken,
}

impl ShutdownReceiver {
    /// Espera la señal de cierre de cualquiera de las dos fuentes.
    ///
    /// Retorna cuando el broadcast recibe el mensaje O cuando el token es cancelado,
    /// lo que ocurra primero. Robusto ante condiciones de carrera.
    pub async fn wait(&mut self) {
        tokio::select! {
            // El error Lagged/Closed en broadcast también indica cierre.
            _ = self.rx.recv() => {}
            _ = self.token.cancelled() => {}
        }
    }

    /// Versión no-async que comprueba si el shutdown ya fue solicitado.
    ///
    /// Útil en bucles síncronos (por ejemplo, dentro de `spawn_blocking`).
    pub fn is_cancelled(&self) -> bool {
        self.token.is_cancelled()
    }
}