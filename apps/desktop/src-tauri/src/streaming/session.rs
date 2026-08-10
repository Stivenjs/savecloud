#![allow(dead_code)]
//! Estado global de la sesión de streaming en el backend.
//!
//! Mantiene referencias a los servicios activos (SunshineHost) y el estado
//! actual de la sesión para ser consultado/modificado por la interfaz (Tauri).

use super::host::SunshineHost;
use std::sync::Arc;
use tauri::AppHandle;

use super::client::MoonlightClient;
use std::sync::Mutex;

/// Representa el estado actual del host de streaming en este dispositivo.
#[derive(Debug, Clone, serde::Serialize)]
pub enum HostState {
    /// Sunshine no está instalado.
    NotInstalled,
    /// Sunshine está instalado pero apagado.
    Stopped,
    /// Sunshine está ejecutándose en segundo plano sin sesión activa.
    Running,
    /// Estamos emitiendo y esperando clientes con este PIN
    Hosting { pin: String, clients: Vec<String> },
    /// Estamos jugando conectados a un host
    Playing { host_ip: String, ws_port: u16 },
    /// Sin actividad de streaming local o remota
    Idle,
    /// Ha ocurrido un error (e.g. falla al descargar).
    Error(String),
}

/// Estructura compartida (State) que Tauri inyecta en los comandos.
pub struct StreamingState {
    pub host: Arc<SunshineHost>,
    pub client: Arc<MoonlightClient>,
    pub session: Arc<Mutex<HostState>>,
}

impl StreamingState {
    pub fn new(app_handle: AppHandle) -> Self {
        let app_data_dir = dirs::data_dir()
            .unwrap_or_else(|| std::env::current_dir().unwrap_or_default())
            .join("SaveCloud");

        let host = SunshineHost::new(app_handle.clone());
        Self {
            host: Arc::new(host),
            client: Arc::new(MoonlightClient::new(&app_data_dir)),
            session: Arc::new(Mutex::new(HostState::Idle)),
        }
    }
}

/// Guarda para asegurar que Sunshine se detenga de forma limpia
/// cuando SaveCloud se cierra de manera inesperada o regular.
pub struct SunshineShutdownGuard {
    host: Arc<SunshineHost>,
}

impl SunshineShutdownGuard {
    pub fn new(host: Arc<SunshineHost>) -> Self {
        Self { host }
    }
}

impl Drop for SunshineShutdownGuard {
    fn drop(&mut self) {
        log::info!("Apagando Sunshine debido a cierre de la aplicación...");
        let host = self.host.clone();
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.spawn(async move {
                let _ = host.stop().await;
            });
        } else {
            tauri::async_runtime::block_on(async move {
                let _ = host.stop().await;
            });
        }
    }
}

