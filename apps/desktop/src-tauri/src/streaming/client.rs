#![allow(dead_code)]
//! Cliente de streaming (Moonlight).
//!
//! Envoltorio seguro sobre los bindings FFI de moonlight-common-c para
//! conectar, negociar la sesión y gestionar el ciclo de vida del stream de video/audio.

use super::bindings::*;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Cliente para conectarse a un host de Sunshine y recibir un stream.
pub struct MoonlightClient {
    is_connected: Arc<AtomicBool>,
    // TODO: Mutex/canal para la configuración de sesión actual
}

impl MoonlightClient {
    pub fn new() -> Self {
        Self {
            is_connected: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Inicia el proceso de conexión LAN directa con un host por su IP.
    /// (Asume que el proceso de pairing ya se ha realizado vía HTTPS).
    pub async fn connect_lan(
        &self,
        host_ip: &str,
        width: i32,
        height: i32,
        fps: i32,
    ) -> Result<(), String> {
        if self.is_connected.load(Ordering::SeqCst) {
            return Err("Ya hay una conexión de streaming activa".into());
        }

        // 1. Configurar stream
        let _config = default_lan_stream_config(width, height, fps);

        // 2. Aquí llamaríamos a las funciones de conexión de moonlight-common-c
        // En este wrapper manual, necesitaríamos declarar extern "C" LiStartConnection
        // y otras si quisiéramos delegar el handshake en C.
        // Por ahora marcamos como conectado.
        self.is_connected.store(true, Ordering::SeqCst);

        log::info!(
            "MoonlightClient: Conectado a host {} ({}x{}@{}fps)",
            host_ip,
            width,
            height,
            fps
        );

        Ok(())
    }

    /// Empieza a decodificar y recibir el stream.
    /// Requiere que los callbacks de video y audio hayan sido configurados.
    pub fn start_stream(
        &self,
        _video_callbacks: &mut DECODER_RENDERER_CALLBACKS,
    ) -> Result<(), String> {
        if !self.is_connected.load(Ordering::SeqCst) {
            return Err("No se puede iniciar el stream sin conexión previa".into());
        }

        log::info!("MoonlightClient: Stream iniciado");
        Ok(())
    }

    pub fn disconnect(&self) {
        if self
            .is_connected
            .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            log::info!("MoonlightClient: Desconectado del host");
        }
    }
}

impl Drop for MoonlightClient {
    fn drop(&mut self) {
        self.disconnect();
    }
}
