#![allow(dead_code)]
//! Estado global de la sesión de streaming en el backend.
//!
//! Mantiene referencias a los servicios activos (SunshineHost) y el estado
//! actual de la sesión para ser consultado/modificado por la interfaz (Tauri).

use super::host::SunshineHost;
use std::sync::Arc;
use tauri::AppHandle;

/// Representa el estado actual del host de streaming en este dispositivo.
#[derive(Debug, Clone, serde::Serialize)]
pub enum HostState {
    /// Sunshine no está instalado.
    NotInstalled,
    /// Sunshine está instalado pero apagado.
    Stopped,
    /// Sunshine está ejecutándose en segundo plano.
    Running,
    /// Ha ocurrido un error (e.g. falla al descargar).
    Error(String),
}

/// Estructura compartida (State) que Tauri inyecta en los comandos.
pub struct StreamingState {
    pub host: Arc<SunshineHost>,
    // Podríamos añadir mutexes adicionales aquí si necesitamos
    // mantener un registro de clientes conectados u otra data.
}

impl StreamingState {
    pub fn new(app_handle: AppHandle) -> Self {
        let host = SunshineHost::new(app_handle.clone());
        Self {
            host: Arc::new(host),
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
    }
}
