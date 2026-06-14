#![allow(dead_code)]
//! Cliente de streaming (Moonlight).
//!
//! Envoltorio seguro sobre los bindings FFI de moonlight-common-c para
//! conectar, negociar la sesión y gestionar el ciclo de vida del stream de video/audio.

use super::bindings::*;
use crate::streaming::video_server::VideoServer;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

/// Cliente para conectarse a un host de Sunshine y recibir un stream.
pub struct MoonlightClient {
    is_connected: Arc<AtomicBool>,
    cert_path: PathBuf,
    key_path: PathBuf,
    video_server: Arc<VideoServer>,
}

impl MoonlightClient {
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        let cert_path = app_data_dir.join("moonlight_client.pem");
        let key_path = app_data_dir.join("moonlight_client.key");

        Self {
            is_connected: Arc::new(AtomicBool::new(false)),
            cert_path,
            key_path,
            video_server: Arc::new(VideoServer::new()),
        }
    }

    /// Genera y retorna el certificado PEM del cliente. Si no existe, lo crea.
    pub fn get_or_create_certificate(&self) -> Result<(String, String), String> {
        if self.cert_path.exists() && self.key_path.exists() {
            let cert = std::fs::read_to_string(&self.cert_path).unwrap_or_default();
            let key = std::fs::read_to_string(&self.key_path).unwrap_or_default();
            if !cert.is_empty() && !key.is_empty() {
                return Ok((cert, key));
            }
        }

        let subject_alt_names = vec!["savecloud-client".to_string()];
        let cert = rcgen::generate_simple_self_signed(subject_alt_names)
            .map_err(|e| format!("Fallo al generar cert: {}", e))?;

        let cert_pem = cert.serialize_pem().map_err(|e| e.to_string())?;
        let key_pem = cert.serialize_private_key_pem();

        if let Some(parent) = self.cert_path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Fallo al crear directorio de certs: {}", e))?;
            }
        }

        std::fs::write(&self.cert_path, &cert_pem).map_err(|e| e.to_string())?;
        std::fs::write(&self.key_path, &key_pem).map_err(|e| e.to_string())?;

        Ok((cert_pem, key_pem))
    }

    pub async fn connect_lan(
        &self,
        host_ip: &str,
        savecloud_port: u16,
        width: i32,
        height: i32,
        fps: i32,
    ) -> Result<u16, String> {
        if self.is_connected.load(Ordering::SeqCst) {
            return Err("Ya hay una conexión de streaming activa".into());
        }

        // 1. Obtener certificado del cliente
        let (cert_pem, _) = self.get_or_create_certificate()?;
        let unique_id = "0123456789ABCDEF"; // TODO: Generar/Guardar un UniqueID real

        // 2. Enviar cert al Host via SaveCloud LAN HTTP API
        let url = format!("http://{}:{}/streaming/pair", host_ip, savecloud_port);
        let payload = serde_json::json!({
            "client_cert": cert_pem,
            "unique_id": unique_id
        });

        let client = reqwest::Client::new();
        let res = client
            .post(&url)
            .json(&payload)
            .send()
            .await
            .map_err(|e| format!("Error conectando a SaveCloud Host: {}", e))?;

        if !res.status().is_success() {
            return Err(format!("Host rechazó emparejamiento: {}", res.status()));
        }

        // 3. Configurar stream y WebSocket
        let _config = default_lan_stream_config(width, height, fps);

        let (tx, rx) = mpsc::channel(120);
        set_video_channel(tx);

        let ws_port = self.video_server.start(rx).await?;
        log::info!("Video WebSocket Server listo en puerto {}", ws_port);

        self.is_connected.store(true, Ordering::SeqCst);

        log::info!(
            "MoonlightClient: Conectado a host {} ({}x{}@{}fps)",
            host_ip,
            width,
            height,
            fps
        );

        Ok(ws_port)
    }

    /// Empieza a decodificar y recibir el stream.
    pub fn start_stream(&self, host_ip: &str) -> Result<(), String> {
        if !self.is_connected.load(Ordering::SeqCst) {
            return Err("No se puede iniciar el stream sin conexión previa".into());
        }

        let ip_cstr = std::ffi::CString::new(host_ip).unwrap();

        std::thread::spawn(move || {
            let mut server_info: SERVER_INFORMATION = unsafe { std::mem::zeroed() };
            initialize_server_information(&mut server_info);
            server_info.address = ip_cstr.as_ptr();

            let mut stream_config = default_lan_stream_config(1920, 1080, 60);

            let mut cl_callbacks: CONNECTION_LISTENER_CALLBACKS = unsafe { std::mem::zeroed() };
            initialize_connection_callbacks(&mut cl_callbacks);

            let dr_callbacks = DECODER_RENDERER_CALLBACKS {
                setup: Some(dr_setup),
                start: Some(dr_start),
                stop: Some(dr_stop),
                cleanup: Some(dr_cleanup),
                submitDecodeUnit: Some(dr_submit_decode_unit),
                capabilities: 0x01, // CAPABILITY_DIRECT_SUBMIT
            };

            log::info!("Llamando a LiStartConnection en hilo de fondo...");
            let result = unsafe {
                LiStartConnection(
                    &mut server_info,
                    &mut stream_config,
                    &mut cl_callbacks,
                    &dr_callbacks as *const _ as *mut _,
                    std::ptr::null_mut(), // Audio callbacks (null por ahora)
                    std::ptr::null_mut(),
                    0,
                    std::ptr::null_mut(),
                    0,
                )
            };

            log::info!("LiStartConnection terminó con código: {}", result);
        });

        log::info!("MoonlightClient: Stream iniciado con callbacks configurados");
        Ok(())
    }

    pub fn disconnect(&self) {
        if self
            .is_connected
            .compare_exchange(true, false, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            unsafe { LiStopConnection() };
            self.video_server.stop();
            log::info!("MoonlightClient: Desconectado del host y WS detenido");
        }
    }
}

impl Drop for MoonlightClient {
    fn drop(&mut self) {
        self.disconnect();
    }
}
