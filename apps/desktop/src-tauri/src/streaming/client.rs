//! Cliente de streaming (Moonlight).
//!
//! Envoltorio seguro sobre los bindings FFI de moonlight-common-c para
//! conectar, negociar la sesión y gestionar el ciclo de vida del stream de video/audio.

use super::bindings::*;
use super::error::{StreamingError, StreamingResult};
use super::tls_override;
use crate::streaming::video_server::VideoServer;
use once_cell::sync::Lazy;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

static SESSION_URL_REGEX: Lazy<regex::Regex> =
    Lazy::new(|| regex::Regex::new(r"<sessionUrl0>(.*?)</sessionUrl0>").unwrap());

static DESKTOP_APP_ID_REGEX: Lazy<regex::Regex> = Lazy::new(|| {
    regex::Regex::new(r"(?s)<App>.*?<AppTitle>Desktop</AppTitle>.*?<ID>(.*?)</ID>.*?<\/App>")
        .unwrap()
});

/// Opciones configurables para la sesión de streaming de video/audio.
#[derive(Debug, Clone)]
pub struct StreamOptions {
    /// Ancho en píxeles de la pantalla remota (ej. 1280, 1920, 2560, 3840)
    pub width: i32,
    /// Alto en píxeles de la pantalla remota (ej. 720, 1080, 1440, 2160)
    pub height: i32,
    /// Cuadros por segundo deseados (ej. 30, 60, 90, 120)
    pub fps: i32,
    /// Tasa de bits en kilobits por segundo (ej. 50000 para 50 Mbps)
    pub bitrate_kbps: i32,
    /// Códec de video soportado (`VIDEO_FORMAT_H264`, `VIDEO_FORMAT_H265`, `VIDEO_FORMAT_AV1_MAIN8`)
    pub video_format: i32,
    /// Sincronización vertical (V-Sync) activa en el cliente
    pub enable_vsync: bool,
    /// Tasa de refresco del monitor local en Hz x 100 (ej. 6000 para 60Hz, 14400 para 144Hz, 24000 para 240Hz)
    pub refresh_rate_x100: i32,
}

impl Default for StreamOptions {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            fps: 60,
            bitrate_kbps: 50_000,
            video_format: VIDEO_FORMAT_H265 | VIDEO_FORMAT_H264 | VIDEO_FORMAT_AV1_MAIN8,
            enable_vsync: true,
            refresh_rate_x100: 6000,
        }
    }
}

/// Cliente para conectarse a un host de Sunshine y recibir un stream.
pub struct MoonlightClient {
    is_connected: Arc<AtomicBool>,
    is_connecting: Arc<AtomicBool>,
    cert_path: PathBuf,
    key_path: PathBuf,
    video_server: Arc<VideoServer>,
}

impl MoonlightClient {
    pub fn new(app_data_dir: &Path) -> Self {
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
    pub fn get_or_create_certificate(&self) -> StreamingResult<(String, String)> {
        if self.cert_path.exists() && self.key_path.exists() {
            let mut cert = std::fs::read_to_string(&self.cert_path).unwrap_or_default();
            let mut key = std::fs::read_to_string(&self.key_path).unwrap_or_default();

            cert = cert.replace("\r\n", "\n");
            key = key.replace("\r\n", "\n");

            if !cert.is_empty() && !key.is_empty() {
                return Ok((cert, key));
            }
        }

        let subject_alt_names = vec!["savecloud-client".to_string()];
        let cert = rcgen::generate_simple_self_signed(subject_alt_names)
            .map_err(|e| StreamingError::Crypto(format!("Fallo al generar cert: {}", e)))?;

        let mut cert_pem = cert
            .serialize_pem()
            .map_err(|e| StreamingError::Crypto(e.to_string()))?;
        let mut key_pem = cert.serialize_private_key_pem();

        cert_pem = cert_pem.replace("\r\n", "\n");
        key_pem = key_pem.replace("\r\n", "\n");

        if let Some(parent) = self.cert_path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    StreamingError::Config(format!("Fallo al crear directorio de certs: {}", e))
                })?;
            }
        }

        std::fs::write(&self.cert_path, &cert_pem)
            .map_err(|e| StreamingError::Config(e.to_string()))?;
        std::fs::write(&self.key_path, &key_pem)
            .map_err(|e| StreamingError::Config(e.to_string()))?;

        Ok((cert_pem, key_pem))
    }

    fn get_or_create_unique_id(&self) -> StreamingResult<String> {
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
                std::fs::create_dir_all(parent).map_err(|e| {
                    StreamingError::Config(format!("Fallo al crear directorio: {}", e))
                })?;
            }
            std::fs::write(&id_path, &new_id).map_err(|e| StreamingError::Config(e.to_string()))?;
            return Ok(new_id);
        }
        Ok("0123456789ABCDEF".to_string())
    }

    /// Realiza el handshake de emparejamiento e inicia el servidor WebSocket local de video.
    pub async fn connect_lan(
        &self,
        host_ip: &str,
        savecloud_port: u16,
        options: &StreamOptions,
    ) -> StreamingResult<u16> {
        if self.is_connected.load(Ordering::SeqCst) {
            return Err(StreamingError::Client(
                "Ya hay una conexión de streaming activa".into(),
            ));
        }

        if self
            .is_connecting
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(StreamingError::Client(
                "La conexión ya está en proceso".into(),
            ));
        }

        struct ConnectingGuard<'a> {
            flag: &'a AtomicBool,
            success: bool,
        }
        impl<'a> Drop for ConnectingGuard<'a> {
            fn drop(&mut self) {
                if !self.success {
                    self.flag.store(false, Ordering::SeqCst);
                }
            }
        }
        let mut guard = ConnectingGuard {
            flag: &self.is_connecting,
            success: false,
        };

        let (cert_pem, _) = self.get_or_create_certificate()?;
        let unique_id = self.get_or_create_unique_id()?;

        let url = format!("https://{}:{}/streaming/pair", host_ip, savecloud_port);
        let payload = serde_json::json!({
            "client_cert": cert_pem,
            "unique_id": unique_id
        });

        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|e| {
                StreamingError::Network(format!(
                    "Error creando cliente HTTP para emparejamiento: {}",
                    e
                ))
            })?;

        let res = client.post(&url).json(&payload).send().await.map_err(|e| {
            StreamingError::Network(format!("Error conectando a SaveCloud Host: {}", e))
        })?;

        if !res.status().is_success() {
            return Err(StreamingError::Network(format!(
                "Host rechazó emparejamiento: {}",
                res.status()
            )));
        }

        let (tx, rx) = mpsc::channel(1024);
        set_video_channel(tx);

        let ws_port = self.video_server.start(rx).await?;

        log::info!("Video WebSocket Server listo en puerto {}", ws_port);

        self.is_connected.store(true, Ordering::SeqCst);
        guard.success = true;
        self.is_connecting.store(false, Ordering::SeqCst);

        log::info!(
            "MoonlightClient: Conectado a host {} ({}x{}@{}fps, {} kbps, codec: {}, vsync: {}, refresh_rate: {}Hz)",
            host_ip,
            options.width,
            options.height,
            options.fps,
            options.bitrate_kbps,
            options.video_format,
            options.enable_vsync,
            options.refresh_rate_x100 as f32 / 100.0
        );

        Ok(ws_port)
    }

    /// Inicia la sesión de transmisión RTSP contra el servidor Sunshine y activa Moonlight-common-c.
    pub async fn start_stream(
        &self,
        host_ip: &str,
        options: &StreamOptions,
    ) -> StreamingResult<()> {
        if !self.is_connected.load(Ordering::SeqCst) {
            return Err(StreamingError::Client(
                "No se puede iniciar el stream sin conexión previa".into(),
            ));
        }

        let (cert_pem, key_pem) = self.get_or_create_certificate()?;
        let unique_id = self.get_or_create_unique_id()?;

        let mut cert_reader = std::io::BufReader::new(cert_pem.as_bytes());
        let certs = rustls_pemfile::certs(&mut cert_reader)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| StreamingError::Crypto(format!("Error leyendo cert: {}", e)))?;

        let mut key_reader = std::io::BufReader::new(key_pem.as_bytes());
        let key = rustls_pemfile::private_key(&mut key_reader)
            .map_err(|e| StreamingError::Crypto(format!("Error leyendo key: {}", e)))?
            .ok_or_else(|| StreamingError::Crypto("No se encontró private key".into()))?;

        let private_key = rustls::crypto::aws_lc_rs::sign::any_supported_type(&key)
            .map_err(|e| StreamingError::Crypto(format!("Key no soportada: {}", e)))?;

        let certified_key = Arc::new(rustls::sign::CertifiedKey::new(certs, private_key));

        let client_cert_resolver =
            Arc::new(tls_override::AlwaysResolvesClientCert { certified_key });

        let provider = rustls::crypto::aws_lc_rs::default_provider();
        let config = rustls::ClientConfig::builder_with_provider(provider.into())
            .with_safe_default_protocol_versions()
            .map_err(|e| StreamingError::Crypto(format!("Error TLS protocol: {}", e)))?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(tls_override::NoCertificateVerification))
            .with_client_cert_resolver(client_cert_resolver);

        let client = reqwest::Client::builder()
            .use_preconfigured_tls(config)
            .http1_only()
            .build()
            .map_err(|e| {
                let mut msg = format!("Error creando cliente HTTP TLS: {}", e);
                if let Some(source) = std::error::Error::source(&e) {
                    msg.push_str(&format!(" (Causa raíz: {})", source));
                }
                StreamingError::Crypto(msg)
            })?;

        let rikey_bytes: [u8; 16] = rand::random();
        let rikey_hex = hex::encode_upper(rikey_bytes);
        let rikey_id: u32 = rand::random();
        let uuid = uuid::Uuid::new_v4().simple().to_string().to_uppercase();

        let mut target_ip = host_ip.to_string();
        if target_ip == "127.0.0.1" {
            target_ip = "localhost".to_string();
        }

        // Obtener el App ID real de "Desktop" desde Sunshine /applist
        let applist_url = format!("https://{}:47984/applist?uniqueid={}", target_ip, unique_id);
        let mut app_id = "1".to_string();

        if let Ok(res) = client.get(&applist_url).send().await {
            if let Ok(xml) = res.text().await {
                log::info!("Respuesta /applist de Sunshine: {}", xml);
                if let Some(caps) = DESKTOP_APP_ID_REGEX.captures(&xml) {
                    app_id = caps[1].trim().to_string();
                    log::info!("App ID para 'Desktop' detectado en Sunshine: {}", app_id);
                }
            }
        }

        // Cancelar cualquier sesión de transmisión activa en Sunshine para aplicar la nueva resolución
        let cancel_url = format!("https://{}:47984/cancel?uniqueid={}", target_ip, unique_id);
        let _ = client.get(&cancel_url).send().await;

        let mode_str = format!("{}x{}x{}", options.width, options.height, options.fps);
        let url = format!(
            "https://{}:47984/launch?uniqueid={}&uuid={}&appversion=7.1.431.0&appid={}&appname=Desktop&mode={}&rikey={}&rikeyid={}&localAudioPlayMode=0",
            target_ip, unique_id, uuid, app_id, mode_str, rikey_hex, rikey_id
        );

        let mut retries = 10;
        let mut last_error = String::new();
        let mut session_url = String::new();

        while retries > 0 {
            match client.get(&url).send().await {
                Ok(res) => match res.text().await {
                    Ok(xml) => {
                        if let Some(caps) = SESSION_URL_REGEX.captures(&xml) {
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
            tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
            retries -= 1;
        }

        if session_url.is_empty() {
            return Err(StreamingError::Network(format!(
                "Error en /launch tras múltiples intentos: {}",
                last_error
            )));
        }

        log::info!("RTSP Session URL obtenido: {}", session_url);

        let ip_cstr = std::ffi::CString::new(host_ip).unwrap();
        let session_url_cstr = std::ffi::CString::new(session_url).unwrap();

        let options_clone = options.clone();

        std::thread::spawn(move || {
            let app_version = std::ffi::CString::new("7.1.431.0").unwrap();
            let gfe_version = std::ffi::CString::new("3.23.0.74").unwrap();

            let mut server_info: SERVER_INFORMATION = unsafe { std::mem::zeroed() };
            initialize_server_information(&mut server_info);
            server_info.address = ip_cstr.as_ptr();
            server_info.serverInfoAppVersion = app_version.as_ptr();
            server_info.serverInfoGfeVersion = gfe_version.as_ptr();
            server_info.serverCodecModeSupport = 0x0101
                | (if options_clone.video_format == VIDEO_FORMAT_AV1_MAIN8 {
                    0x1000
                } else {
                    0
                });
            server_info.rtspSessionUrl = session_url_cstr.as_ptr();

            let mut stream_config = custom_lan_stream_config(
                options_clone.width,
                options_clone.height,
                options_clone.fps,
                options_clone.bitrate_kbps,
                options_clone.video_format,
                options_clone.refresh_rate_x100,
            );

            let mut rikey_c = [0i8; 16];
            for i in 0..16 {
                rikey_c[i] = rikey_bytes[i] as i8;
            }
            stream_config.remoteInputAesKey = rikey_c;

            let mut iv_c = [0i8; 16];
            let rikey_id_bytes = rikey_id.to_be_bytes();
            for i in 0..4 {
                iv_c[i] = rikey_id_bytes[i] as i8;
            }
            stream_config.remoteInputAesIv = iv_c;

            let mut cl_callbacks: CONNECTION_LISTENER_CALLBACKS = unsafe { std::mem::zeroed() };
            initialize_connection_callbacks(&mut cl_callbacks);
            cl_callbacks.stageStarting = cl_stage_starting as *mut std::ffi::c_void;
            cl_callbacks.stageComplete = cl_stage_complete as *mut std::ffi::c_void;
            cl_callbacks.stageFailed = cl_stage_failed as *mut std::ffi::c_void;
            cl_callbacks.connectionStarted = cl_connection_started as *mut std::ffi::c_void;
            cl_callbacks.connectionTerminated = cl_connection_terminated as *mut std::ffi::c_void;
            cl_callbacks.logMessage = cl_log_message as *mut std::ffi::c_void;

            let dr_callbacks = DECODER_RENDERER_CALLBACKS {
                setup: Some(dr_setup),
                start: Some(dr_start),
                stop: Some(dr_stop),
                cleanup: Some(dr_cleanup),
                submitDecodeUnit: Some(dr_submit_decode_unit),
                capabilities: 0x01, // CAPABILITY_DIRECT_SUBMIT
            };

            let mut ar_callbacks: AUDIO_RENDERER_CALLBACKS = unsafe { std::mem::zeroed() };
            initialize_audio_callbacks(&mut ar_callbacks);
            ar_callbacks.init = Some(super::audio::ar_init);
            ar_callbacks.start = Some(super::audio::ar_start);
            ar_callbacks.stop = Some(super::audio::ar_stop);
            ar_callbacks.cleanup = Some(super::audio::ar_cleanup);
            ar_callbacks.decodeAndPlaySample = Some(super::audio::ar_decode_and_play_sample);
            ar_callbacks.capabilities = 0x00; // 0 = Permitir a Moonlight decodificar Opus a PCM 16-bit 48kHz

            log::info!("Llamando a LiStartConnection en hilo de fondo...");
            let result = unsafe {
                LiStartConnection(
                    &mut server_info,
                    &mut stream_config,
                    &mut cl_callbacks,
                    &dr_callbacks as *const _ as *mut _,
                    &mut ar_callbacks as *mut _,
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
        self.is_connecting.store(false, Ordering::SeqCst);
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
