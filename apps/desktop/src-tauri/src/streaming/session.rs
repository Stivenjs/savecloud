//! # Estado Global de la Sesión de Streaming en el Backend
//!
//! Este módulo define los tipos y estructuras compartidas para la gestión del estado
//! de la sesión de game streaming (Sunshine Host y Moonlight Client).


use super::client::MoonlightClient;
use super::host::SunshineHost;
use std::fmt::Debug;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;

/// Representa el estado operacional del subsistema de streaming en este dispositivo.
///
/// Refleja la actividad actual del host local (Sunshine) y del cliente (Moonlight),
/// permitiendo a la interfaz de usuario en React reaccionar a los cambios de estado.
#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub enum HostState {
    /// Sunshine no está instalado en el sistema local.
    NotInstalled,

    /// Sunshine está instalado en el equipo pero se encuentra detenido.
    Stopped,

    /// Sunshine se encuentra activo en segundo plano listo para recibir conexiones o emparejamientos.
    Running,

    /// El dispositivo local está actuando como Host, emitiendo pantalla y esperando clientes con el PIN indicado.
    Hosting {
        /// PIN de emparejamiento generado para autorizar clientes.
        pin: String,
        /// Lista de IDs o direcciones de clientes conectados.
        clients: Vec<String>,
    },

    /// El dispositivo local está jugando conectado como cliente a un host remoto o local.
    Playing {
        /// Dirección IP del host al que está conectado.
        host_ip: String,
        /// Puerto WebSocket local asignado para la recepción de video.
        ws_port: u16,
    },

    /// Sin actividad de streaming activa (Host ni Cliente).
    Idle,

    /// Ha ocurrido un error crítico en el subsistema de streaming.
    Error(String),
}

#[allow(dead_code)]
impl HostState {
    /// Determina si hay una sesión activa de streaming (emitiendo como Host o jugando como Cliente).
    ///
    /// # Returns
    /// Retorna `true` si el estado es [`HostState::Hosting`] o [`HostState::Playing`].
    #[must_use]
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Hosting { .. } | Self::Playing { .. })
    }

    /// Comprueba si el dispositivo local está emitiendo como Host.
    ///
    /// # Returns
    /// Retorna `true` únicamente si el estado es [`HostState::Hosting`].
    #[must_use]
    pub fn is_hosting(&self) -> bool {
        matches!(self, Self::Hosting { .. })
    }

    /// Comprueba si el dispositivo local se encuentra jugando como Cliente.
    ///
    /// # Returns
    /// Retorna `true` únicamente si el estado es [`HostState::Playing`].
    #[must_use]
    pub fn is_playing(&self) -> bool {
        matches!(self, Self::Playing { .. })
    }

    /// Comprueba si la sesión se encuentra en estado inactivo.
    ///
    /// # Returns
    /// Retorna `true` si el estado es [`HostState::Idle`].
    #[must_use]
    pub fn is_idle(&self) -> bool {
        matches!(self, Self::Idle)
    }

    /// Comprueba si el estado representa un error.
    ///
    /// # Returns
    /// Retorna `true` si el estado es [`HostState::Error`].
    #[must_use]
    pub fn is_error(&self) -> bool {
        matches!(self, Self::Error(_))
    }
}

/// Estado global del subsistema de streaming inyectado en el gestor de estados de Tauri.
///
/// Proporciona acceso thread-safe a las instancias singleton de [`SunshineHost`],
/// [`MoonlightClient`] y al estado sincronizado de la sesión [`HostState`].
#[derive(Clone)]
pub struct StreamingState {
    /// Referencia compartida al host local de Sunshine.
    pub host: Arc<SunshineHost>,
    /// Referencia compartida al cliente local de Moonlight.
    pub client: Arc<MoonlightClient>,
    /// Estado global de la sesión sincronizado con cerrojo de exclusión mutua.
    pub session: Arc<Mutex<HostState>>,
}

impl Debug for StreamingState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamingState")
            .field("session", &self.get_session_state())
            .finish_non_exhaustive()
    }
}

impl StreamingState {
    /// Crea una nueva instancia de [`StreamingState`] e inicializa los servicios del subsistema.
    ///
    /// # Arguments
    /// * `app_handle` - Instancia de [`AppHandle`] para la integración con Tauri.
    ///
    /// # Returns
    /// Retorna una nueva instancia estructurada de [`StreamingState`].
    ///
    /// # Examples
    /// ```rust,ignore
    /// let state = StreamingState::new(app_handle);
    /// ```
    #[must_use]
    pub fn new(app_handle: AppHandle) -> Self {
        let app_data_dir = resolve_app_data_dir();
        let host = SunshineHost::new(app_handle);

        Self {
            host: Arc::new(host),
            client: Arc::new(MoonlightClient::new(&app_data_dir)),
            session: Arc::new(Mutex::new(HostState::Idle)),
        }
    }

    /// Obtiene una copia del estado actual de la sesión de forma thread-safe.
    ///
    /// Resiliente ante envenenamiento del Mutex (*lock poisoning*).
    ///
    /// # Returns
    /// Retorna la copia del [`HostState`] actual.
    #[must_use]
    pub fn get_session_state(&self) -> HostState {
        self.session
            .lock()
            .unwrap_or_else(|poison_err| poison_err.into_inner())
            .clone()
    }

    /// Actualiza el estado actual de la sesión de forma thread-safe.
    ///
    /// # Arguments
    /// * `new_state` - Nuevo estado [`HostState`] a establecer.
    #[allow(dead_code)]
    pub fn set_session_state(&self, new_state: HostState) {
        let mut lock = self
            .session
            .lock()
            .unwrap_or_else(|poison_err| poison_err.into_inner());

        if *lock != new_state {
            log::info!(
                "[StreamingState] Transición de estado: {:?} -> {:?}",
                *lock,
                new_state
            );
            *lock = new_state;
        }
    }

    /// Restablece el estado de la sesión a [`HostState::Idle`].
    #[allow(dead_code)]
    pub fn reset_session_state(&self) {
        self.set_session_state(HostState::Idle);
    }
}

/// Resuelve de forma segura el directorio base de datos para la aplicación.
fn resolve_app_data_dir() -> PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
        .join("SaveCloud")
}

/// Guarda de seguridad (Centinela) para garantizar que el proceso de Sunshine se detenga limpiamente
/// al cerrarse la aplicación desktop.
pub struct SunshineShutdownGuard {
    host: Arc<SunshineHost>,
}

impl Debug for SunshineShutdownGuard {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SunshineShutdownGuard")
            .finish_non_exhaustive()
    }
}

impl SunshineShutdownGuard {
    /// Crea un nuevo centinela [`SunshineShutdownGuard`].
    ///
    /// # Arguments
    /// * `host` - Referencia compartida [`Arc<SunshineHost>`] a supervisar durante el apagado.
    ///
    /// # Returns
    /// Retorna la instancia de [`SunshineShutdownGuard`].
    #[must_use]
    pub fn new(host: Arc<SunshineHost>) -> Self {
        Self { host }
    }
}

impl Drop for SunshineShutdownGuard {
    /// Se ejecuta automáticamente al destruirse la instancia de [`SunshineShutdownGuard`].
    ///
    /// Solicita de forma asíncrona y no bloqueante la detención del proceso Sunshine Host.
    fn drop(&mut self) {
        log::info!("[SunshineShutdownGuard] Apagando Sunshine debido al cierre de la aplicación...");
        let host = self.host.clone();

        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _ = host.stop().await;
            });
        } else {
            tauri::async_runtime::spawn(async move {
                let _ = host.stop().await;
            });
        }
    }
}


