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
    is_connecting: Arc<AtomicBool>,
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
            is_connecting: Arc::new(AtomicBool::new(false)),
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

    fn get_or_create_unique_id(&self) -> Result<String, String> {
        if let Some(parent) = self.cert_path.parent() {
            let id_path = parent.join("client_id.txt");
            if id_path.exists() {
                if let Ok(id) = std::fs::read_to_string(&id_path) {
                    let trimmed = id.trim().to_string();
                    if trimmed.len() == 16 {
                        return Ok(trimmed);
                    }
                }
            }

            let bytes: [u8; 8] = rand::random();
            let new_id = hex::encode_upper(bytes);

            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Fallo al crear directorio: {}", e))?;
            }
            std::fs::write(&id_path, &new_id).map_err(|e| e.to_string())?;
            return Ok(new_id);
        }
        Ok("0123456789ABCDEF".to_string())
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

        if self
            .is_connecting
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err("La conexión ya está en proceso".into());
        }

        // 1. Obtener certificado del cliente
        let (cert_pem, _) = self.get_or_create_certificate()?;
        let unique_id = self.get_or_create_unique_id()?;

        // 2. Enviar cert al Host via SaveCloud LAN HTTP API
        let url = format!("http://{}:{}/streaming/pair", host_ip, savecloud_port);
        let payload = serde_json::json!({
            "client_cert": cert_pem,
            "unique_id": unique_id
        });

        let client = reqwest::Client::new();
        let res = client.post(&url).json(&payload).send().await;

        let res = match res {
            Ok(r) => r,
            Err(e) => {
                self.is_connecting.store(false, Ordering::SeqCst);
                return Err(format!("Error conectando a SaveCloud Host: {}", e));
            }
        };

        if !res.status().is_success() {
            self.is_connecting.store(false, Ordering::SeqCst);
            return Err(format!("Host rechazó emparejamiento: {}", res.status()));
        }

        // 3. Configurar stream y WebSocket
        let _config = default_lan_stream_config(width, height, fps);

        let (tx, rx) = mpsc::channel(120);
        set_video_channel(tx);

        let ws_port = match self.video_server.start(rx).await {
            Ok(p) => p,
            Err(e) => {
                self.is_connecting.store(false, Ordering::SeqCst);
                return Err(e);
            }
        };

        log::info!("Video WebSocket Server listo en puerto {}", ws_port);

        self.is_connected.store(true, Ordering::SeqCst);
        self.is_connecting.store(false, Ordering::SeqCst);

        log::info!(
            "MoonlightClient: Conectado a host {} ({}x{}@{}fps)",
            host_ip,
            width,
            height,
            fps
        );

        Ok(ws_port)
    }

    pub async fn start_stream(&self, host_ip: &str) -> Result<(), String> {
        if !self.is_connected.load(Ordering::SeqCst) {
            return Err("No se puede iniciar el stream sin conexión previa".into());
        }

        let (cert_pem, key_pem) = self.get_or_create_certificate()?;
        let unique_id = self.get_or_create_unique_id()?;

        let combined_pem = format!("{}\n{}", key_pem, cert_pem);
        let identity = reqwest::Identity::from_pem(combined_pem.as_bytes())
            .map_err(|e| format!("Error TLS identity: {}", e))?;

        let client = reqwest::Client::builder()
            .use_rustls_tls()
            .danger_accept_invalid_certs(true)
            .identity(identity)
            .build()
            .map_err(|e| {
                let mut msg = format!("Error creando cliente HTTP TLS: {}", e);
                if let Some(source) = std::error::Error::source(&e) {
                    msg.push_str(&format!(" (Causa raíz: {})", source));
                }
                msg
            })?;

        let rikey_bytes: [u8; 16] = rand::random();
        let rikey_hex = hex::encode_upper(rikey_bytes);
        let rikey_id: u32 = rand::random();
        let uuid = uuid::Uuid::new_v4().simple().to_string().to_uppercase();

        let url = format!(
            "https://{}:47989/launch?uniqueid={}&uuid={}&appversion=7.1.431.0&appid=0&appname=Desktop&mode=1920x1080x60&rikey={}&rikeyid={}&localAudioPlayMode=0",
            host_ip, unique_id, uuid, rikey_hex, rikey_id
        );

        let mut retries = 10;
        let mut last_error = String::new();
        let mut session_url = String::new();

        while retries > 0 {
            match client.get(&url).send().await {
                Ok(res) => match res.text().await {
                    Ok(xml) => {
                        let session_url_regex =
                            regex::Regex::new(r"<sessionUrl0>(.*?)</sessionUrl0>").unwrap();
                        if let Some(caps) = session_url_regex.captures(&xml) {
                            session_url = caps[1].to_string();
                            break;
                        } else {
                            last_error = format!("Respuesta /launch sin sessionUrl0. XML: {}", xml);
                            log::warn!("Reintentando /launch: {}", last_error);
                        }
                    }
                    Err(e) => {
                        last_error = format!("Error leyendo respuesta XML: {}", e);
                    }
                },
                Err(e) => {
                    last_error = format!("Error de red: {}", e);
                    log::info!(
                        "Esperando a que Sunshine inicie (intento restante {})... {}",
                        retries,
                        last_error
                    );
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
            retries -= 1;
        }

        if session_url.is_empty() {
            return Err(format!(
                "Error en /launch tras múltiples intentos: {}",
                last_error
            ));
        }

        log::info!("RTSP Session URL obtenido: {}", session_url);

        let ip_cstr = std::ffi::CString::new(host_ip).unwrap();
        let session_url_cstr = std::ffi::CString::new(session_url).unwrap();

        std::thread::spawn(move || {
            let app_version = std::ffi::CString::new("7.1.431.0").unwrap();
            let gfe_version = std::ffi::CString::new("3.23.0.74").unwrap();

            let mut server_info: SERVER_INFORMATION = unsafe { std::mem::zeroed() };
            initialize_server_information(&mut server_info);
            server_info.address = ip_cstr.as_ptr();
            server_info.serverInfoAppVersion = app_version.as_ptr();
            server_info.serverInfoGfeVersion = gfe_version.as_ptr();
            server_info.serverCodecModeSupport = 0x0101;
            server_info.rtspSessionUrl = session_url_cstr.as_ptr();

            let mut stream_config = default_lan_stream_config(1920, 1080, 60);

            let mut rikey_c = [0i8; 16];
            for i in 0..16 {
                rikey_c[i] = rikey_bytes[i] as i8;
            }
            stream_config.remoteInputAesKey = rikey_c;
            stream_config.remoteInputAesIv = [0i8; 16];

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
