//! Sistema de cierre seguro y ordenado de la aplicación.
//!
//! # Problema
//!
//! Cuando el usuario cierra la ventana mientras hay operaciones pesadas en vuelo
//! (empaquetado TAR, compresión ZSTD, subidas multipart a S3, descargas P2P
//! BitTorrent), el proceso de Rust puede quedar bloqueado indefinidamente porque:
//!
//! - Los hilos blocking lanzados con [`tokio::task::spawn_blocking`] no reciben
//!   la señal de cierre de Tauri y continúan ejecutándose en segundo plano.
//! - La sesión de `librqbit` mantiene sockets TCP abiertos y tareas internas que
//!   no se destruyen a menos que [`Session`] se droppee explícitamente.
//! - El runtime de Tokio no puede terminar mientras haya tareas vivas, y las
//!   tareas blocking cuentan como "vivas" hasta que su hilo OS termina.
//!
//! # Solución
//!
//! Este módulo implementa un bus de señales basado en [`tokio::sync::broadcast`]
//! que propaga un token de cancelación a todos los subsistemas que deben
//! interrumpirse limpiamente antes de que el proceso pueda salir:
//!
//! 1. **`ShutdownBus`**: singleton del canal broadcast. Se inicializa una sola
//!    vez en `main.rs` y se registra como estado gestionado de Tauri.
//! 2. **`ShutdownGuard`**: token de cancelación que cada subsistema mantiene
//!    mientras está activo. Cuando recibe la señal, usa su `CancellationToken`
//!    para interrumpir sus operaciones en curso.
//! 3. **`ShutdownCoordinator`**: orquesta el cierre en fases ordenadas, esperando
//!    a que cada subsistema confirme su terminación antes de avanzar.
//!
//! # Integración con Tauri
//!
//! El hook `on_window_event` de Tauri llama a [`request_shutdown`] cuando el
//! usuario cierra la última ventana. Desde ahí, el coordinador ejecuta las fases
//! en orden y, solo cuando todas terminan limpiamente (o expira el timeout de
//! emergencia), permite que el proceso salga.
//!
//! # Timeouts
//!
//! Cada fase tiene su propio timeout configurado en [`ShutdownPhase`]. Si una
//! fase no termina a tiempo, se registra el error y se continúa con la siguiente
//! para evitar que la app quede colgada indefinidamente. El timeout global de
//! emergencia en [`EMERGENCY_KILL_SECS`] garantiza que el proceso muere en un
//! tiempo acotado incluso en el peor caso.
//!
//! # Ejemplo de uso
//!
//! ```rust,no_run
//! // En main.rs:
//! let shutdown_bus = ShutdownBus::new();
//! app.manage(shutdown_bus.clone());
//!
//! // En cada subsistema (ej. multipart.rs):
//! let mut guard = shutdown_bus.subscribe();
//! loop {
//!     tokio::select! {
//!         _ = guard.cancelled() => break,  // Cierre limpio
//!         msg = rx.recv() => { /* procesar chunk */ }
//!     }
//! }
//!
//! // En el hook de cierre de Tauri:
//! tauri::Builder::default()
//!     .on_window_event(|window, event| {
//!         if let tauri::WindowEvent::CloseRequested { .. } = event {
//!             let bus = window.state::<ShutdownBus>();
//!             tauri::async_runtime::block_on(request_shutdown(bus.inner()));
//!         }
//!     })
//! ```
#![allow(dead_code)]
pub mod bus;
pub mod coordinator;
pub mod guard;
pub mod hooks;
pub mod splash;

pub use bus::ShutdownBus;
pub use coordinator::ShutdownCoordinator;
pub use guard::ShutdownGuard;
