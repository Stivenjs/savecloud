//! # Cliente de Transmisión RTSP (Moonlight Client)
//!
//! Este módulo implementa [`MoonlightClient`], una envoltura de alto nivel y thread-safe
//! sobre los bindings FFI de `moonlight-common-c` para gestionar la negociación TLS/RTSP,
//! la sincronización de certificados y la inicialización del motor de renderizado de video/audio.

use super::bindings::*;
use super::error::{StreamingError, StreamingResult};
use super::tls_override;
use crate::streaming::video_server::VideoServer;
use crate::streaming::webtransport_server::WebTransportServer;
use std::ffi::CString;
use std::fmt::Debug;
use std::mem::MaybeUninit;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tokio::sync::mpsc;

/// Expresión regular pre-compilada para extraer la URL RTSP de la respuesta XML de Sunshine.
static SESSION_URL_REGEX: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"<sessionUrl0>(.*?)</sessionUrl0>").unwrap());

/// Expresión regular pre-compilada para extraer el App ID de "Desktop" desde Sunshine.
static DESKTOP_APP_ID_REGEX: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"(?s)<App>.*?<AppTitle>Desktop</AppTitle>.*?<ID>(.*?)</ID>.*?<\/App>")
        .unwrap()
});

/// Resultados de puertos y credenciales de transporte entregados al cliente.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ConnectResult {
    pub ws_port: u16,
    pub webtransport_port: u16,
    pub cert_hash: String,
}
/// Opciones configurables para la sesión de transmisión de video y audio.
#[derive(Debug, Clone)]
pub struct StreamOptions {
    /// Ancho en píxeles de la pantalla remota (ej. 1280, 1920, 2560, 3840).
    pub width: i32,
    /// Alto en píxeles de la pantalla remota (ej. 720, 1080, 1440, 2160).
    pub height: i32,
    /// Tasa de refresco objetivo en FPS (ej. 30, 60, 90, 120).
    pub fps: i32,
    /// Tasa de bits en Kilobits por segundo (ej. 5000 a 100000 kbps).
    pub bitrate_kbps: i32,
    /// Códec de video soportado (`VIDEO_FORMAT_H264`, `VIDEO_FORMAT_H265`, `VIDEO_FORMAT_AV1_MAIN8`).
    pub video_format: i32,
    /// Activar sincronización vertical (V-Sync) en el cliente.
    pub enable_vsync: bool,
    /// Tasa de refresco del monitor local en Hz x 100 (ej. 6000 para 60Hz, 14400 para 144Hz, 24000 para 240Hz).
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

/// Cliente de alto nivel para gestionar la sesión de game streaming con Sunshine.
pub struct MoonlightClient {
    is_connected: Arc<AtomicBool>,
    is_connecting: Arc<AtomicBool>,
    cert_path: PathBuf,
    key_path: PathBuf,
    video_server: Arc<VideoServer>,
    webtransport_server: Arc<WebTransportServer>,
    last_host_ip: Arc<Mutex<Option<String>>>,
}

impl Debug for MoonlightClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MoonlightClient")
            .field("is_connected", &self.is_connected.load(Ordering::Relaxed))
            .field("is_connecting", &self.is_connecting.load(Ordering::Relaxed))
            .field("cert_path", &self.cert_path)
            .field("key_path", &self.key_path)
            .finish_non_exhaustive()
    }
}

impl MoonlightClient {
    /// Crea una nueva instancia de [`MoonlightClient`].
    ///
    /// # Arguments
    /// * `app_data_dir` - Ruta del directorio base donde se almacenan certificados y credenciales del cliente.
    ///
    /// # Returns
    /// Retorna una nueva instancia estructurada de [`MoonlightClient`].
    ///
    /// # Examples
    /// ```rust,ignore
    /// let client = MoonlightClient::new(Path::new("/app/data"));
    /// ```
    #[must_use]
    pub fn new(app_data_dir: &Path) -> Self {
        let cert_path = app_data_dir.join("moonlight_client.pem");
        let key_path = app_data_dir.join("moonlight_client.key");

        Self {
            is_connected: Arc::new(AtomicBool::new(false)),
            is_connecting: Arc::new(AtomicBool::new(false)),
            cert_path,
            key_path,
            video_server: Arc::new(VideoServer::new()),
            webtransport_server: Arc::new(WebTransportServer::new()),
            last_host_ip: Arc::new(Mutex::new(None)),
        }
    }

    /// Genera y retorna el certificado PEM del cliente y su clave privada.
    ///
    /// Si los archivos de certificado ya existen en disco, los lee y normaliza saltos de línea.
    /// Si no existen, genera un certificado autofirmado X.509 y lo persiste en disco.
    ///
    /// # Returns
    /// Retorna una tupla `(cert_pem, key_pem)` con el contenido en formato PEM.
    ///
    /// # Errors
    /// Retorna [`StreamingError::Crypto`] o [`StreamingError::Config`] si ocurre un error al generar o guardar las claves.
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
            .map_err(|err| StreamingError::Crypto(format!("Fallo al generar certificado X.509: {err}")))?;

        let mut cert_pem = cert
            .serialize_pem()
            .map_err(|err| StreamingError::Crypto(err.to_string()))?;
        let mut key_pem = cert.serialize_private_key_pem();

        cert_pem = cert_pem.replace("\r\n", "\n");
        key_pem = key_pem.replace("\r\n", "\n");

        if let Some(parent) = self.cert_path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|err| {
                    StreamingError::Config(format!("Fallo al crear directorio de certificados: {err}"))
                })?;
            }
        }

        std::fs::write(&self.cert_path, &cert_pem)
            .map_err(|err| StreamingError::Config(err.to_string()))?;
        std::fs::write(&self.key_path, &key_pem)
            .map_err(|err| StreamingError::Config(err.to_string()))?;

        Ok((cert_pem, key_pem))
    }

    /// Obtiene o genera un ID único de 16 caracteres hexadecimales para este cliente.
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
                std::fs::create_dir_all(parent).map_err(|err| {
                    StreamingError::Config(format!("Fallo al crear directorio para cliente: {err}"))
                })?;
            }
            std::fs::write(&id_path, &new_id).map_err(|err| StreamingError::Config(err.to_string()))?;
            return Ok(new_id);
        }
        Ok("0123456789ABCDEF".to_string())
    }

    /// Realiza el handshake de emparejamiento con el Host e inicia el servidor WebSocket local de video.
    ///
    /// # Arguments
    /// * `host_ip` - Dirección IP del Host Sunshine.
    /// * `savecloud_port` - Puerto del servidor de señalización de SaveCloud (e.g., 9879).
    /// * `options` - Referencia a las opciones de pantalla y rendimiento [`StreamOptions`].
    ///
    /// # Returns
    /// * `Ok(u16)` - Puerto dinámico asignado para el servidor WebSocket local de video.
    /// * `Err(StreamingError)` - Si falla el emparejamiento o la conexión inicial.
    ///
    /// # Errors
    /// Retorna error si ya existe una sesión activa o en proceso de conexión.
    pub async fn connect_lan(
        &self,
        host_ip: &str,
        savecloud_port: u16,
        options: &StreamOptions,
    ) -> StreamingResult<ConnectResult> {
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

        let url = format!("https://{host_ip}:{savecloud_port}/streaming/pair");
        let payload = serde_json::json!({
            "client_cert": cert_pem,
            "unique_id": unique_id
        });

        let client = reqwest::Client::builder()
            .danger_accept_invalid_certs(true)
            .timeout(std::time::Duration::from_secs(10))
            .build()
            .map_err(|err| {
                StreamingError::Network(format!(
                    "Error creando cliente HTTP para emparejamiento: {err}"
                ))
            })?;

        let res = client.post(&url).json(&payload).send().await.map_err(|err| {
            StreamingError::Network(format!("Error conectando a SaveCloud Host: {err}"))
        })?;

        if !res.status().is_success() {
            return Err(StreamingError::Network(format!(
                "Host rechazó emparejamiento: {}",
                res.status()
            )));
        }

        let (tx_main, mut rx_main) = mpsc::channel::<Vec<u8>>(1024);
        let (bcast_tx, _bcast_rx) = tokio::sync::broadcast::channel::<Vec<u8>>(1024);

        let bcast_tx_clone = bcast_tx.clone();
        tokio::spawn(async move {
            while let Some(frame) = rx_main.recv().await {
                let _ = bcast_tx_clone.send(frame);
            }
        });

        set_video_channel(tx_main);

        let ws_port = self.video_server.start(bcast_tx.clone()).await?;
        let wt_info = self.webtransport_server.start(bcast_tx).await?;

        log::info!(
            "[Client] Servidores de streaming activos: WebSocket TCP (puerto {ws_port}) y WebTransport UDP (puerto {})",
            wt_info.port
        );

        if let Ok(mut host_guard) = self.last_host_ip.lock() {
            *host_guard = Some(host_ip.to_string());
        }

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

        Ok(ConnectResult {
            ws_port,
            webtransport_port: wt_info.port,
            cert_hash: wt_info.cert_hash_hex,
        })
    }

    /// Inicia la sesión de transmisión RTSP contra el servidor Sunshine e invoca el motor FFI Moonlight-C.
    ///
    /// # Arguments
    /// * `host_ip` - Dirección IP del Host Sunshine.
    /// * `options` - Opciones de configuración de la transmisión [`StreamOptions`].
    ///
    /// # Errors
    /// Retorna error si no hay una conexión previa establecida o si falla el protocolo RTSP / TLS.
    ///
    /// # Latency & Performance Notes
    /// - Aplica reintentos ágiles con intervalos reducidos a 200ms en lugar de 1500ms para iniciar la sesión 1.2s-2.5s más rápido.
    /// - Construcción segura de tipos `CString` evadiendo panics por valores nulos.
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
            .map_err(|err| StreamingError::Crypto(format!("Error leyendo certificado: {err}")))?;

        let mut key_reader = std::io::BufReader::new(key_pem.as_bytes());
        let key = rustls_pemfile::private_key(&mut key_reader)
            .map_err(|err| StreamingError::Crypto(format!("Error leyendo clave privada: {err}")))?
            .ok_or_else(|| StreamingError::Crypto("No se encontró clave privada".into()))?;

        let private_key = rustls::crypto::aws_lc_rs::sign::any_supported_type(&key)
            .map_err(|err| StreamingError::Crypto(format!("Clave no soportada: {err}")))?;

        let certified_key = Arc::new(rustls::sign::CertifiedKey::new(certs, private_key));

        let client_cert_resolver =
            Arc::new(tls_override::AlwaysResolvesClientCert { certified_key });

        let provider = rustls::crypto::aws_lc_rs::default_provider();
        let config = rustls::ClientConfig::builder_with_provider(provider.into())
            .with_safe_default_protocol_versions()
            .map_err(|err| StreamingError::Crypto(format!("Error en protocolo TLS: {err}")))?
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(tls_override::NoCertificateVerification))
            .with_client_cert_resolver(client_cert_resolver);

        let client = reqwest::Client::builder()
            .use_preconfigured_tls(config)
            .http1_only()
            .build()
            .map_err(|err| {
                let mut msg = format!("Error creando cliente HTTP TLS: {err}");
                if let Some(source) = std::error::Error::source(&err) {
                    msg.push_str(&format!(" (Causa raíz: {source})"));
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

        // Obtener el App ID real de "Desktop" desde Sunshine /applist (puerto 47984 HTTPS)
        let applist_url = format!("https://{target_ip}:47984/applist?uniqueid={unique_id}");
        let mut app_id = "1".to_string();

        if let Ok(res) = client.get(&applist_url).send().await {
            if let Ok(xml) = res.text().await {
                log::info!("Respuesta /applist de Sunshine: {xml}");
                if let Some(caps) = DESKTOP_APP_ID_REGEX.captures(&xml) {
                    app_id = caps[1].trim().to_string();
                    log::info!("App ID para 'Desktop' detectado en Sunshine: {app_id}");
                }
            }
        }

        // Cancelar de forma asíncrona cualquier sesión previa para asegurar la nueva resolución
        cancel_sunshine_session(&client, &target_ip, &unique_id).await;
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        let mode_str = format!("{}x{}x{}", options.width, options.height, options.fps);

        let url = format!(
            "https://{target_ip}:47984/launch?uniqueid={unique_id}&uuid={uuid}&appversion=7.1.431.0&appid={app_id}&appname=Desktop&mode={mode_str}&rikey={rikey_hex}&rikeyid={rikey_id}&localAudioPlayMode=0"
        );
        let resume_url = format!(
            "https://{target_ip}:47984/resume?uniqueid={unique_id}&uuid={uuid}&appversion=7.1.431.0&rikey={rikey_hex}&rikeyid={rikey_id}"
        );

        
        let mut retries = 25;
        let mut last_error = String::new();
        let mut session_url = String::new();

        while retries > 0 {
            match client.get(&url).send().await {
                Ok(res) => match res.text().await {
                    Ok(xml) => {
                        if let Some(caps) = SESSION_URL_REGEX.captures(&xml) {
                            session_url = caps[1].to_string();
                            break;
                        } else if xml.contains("already running") || xml.contains("400") {
                            log::info!("Sunshine reporta sesión activa. Intentando /resume...");
                            if let Ok(resume_res) = client.get(&resume_url).send().await {
                                if let Ok(resume_xml) = resume_res.text().await {
                                    if let Some(caps) = SESSION_URL_REGEX.captures(&resume_xml) {
                                        session_url = caps[1].to_string();
                                        log::info!("Sesión reanudada exitosamente vía /resume");
                                        break;
                                    }
                                }
                            }
                            log::warn!(
                                "Fallo al reanudar vía /resume. Cancelando sesión previa en Sunshine..."
                            );
                            cancel_sunshine_session(&client, &target_ip, &unique_id).await;
                            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                            last_error = format!("Sunshine tenía sesión activa. Se envió /cancel en puerto 47984 para reintentar /launch. XML: {xml}");
                        } else {
                            last_error = format!("Respuesta /launch sin sessionUrl0. XML: {xml}");
                            log::warn!("Reintentando /launch: {last_error}");
                        }
                    }
                    Err(err) => {
                        last_error = format!("Error leyendo respuesta XML: {err}");
                    }
                },
                Err(err) => {
                    last_error = format!("Error de red: {err}");
                    log::debug!(
                        "Esperando a que Sunshine esté listo (intento restante {retries})... {last_error}"
                    );
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            retries -= 1;
        }

        if session_url.is_empty() {
            return Err(StreamingError::Network(format!(
                "Error en /launch tras múltiples intentos: {last_error}"
            )));
        }

        log::info!("RTSP Session URL obtenido: {session_url}");

        let ip_cstr = CString::new(host_ip)
            .map_err(|err| StreamingError::Config(format!("IP inválida para CString: {err}")))?;
        let session_url_cstr = CString::new(session_url)
            .map_err(|err| StreamingError::Config(format!("Session URL inválida para CString: {err}")))?;

        let options_clone = options.clone();

        std::thread::spawn(move || {
            let app_version = CString::new("7.1.431.0").unwrap_or_default();
            let gfe_version = CString::new("3.23.0.74").unwrap_or_default();

            let mut server_info: SERVER_INFORMATION = unsafe { MaybeUninit::zeroed().assume_init() };
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

            let mut cl_callbacks: CONNECTION_LISTENER_CALLBACKS = unsafe { MaybeUninit::zeroed().assume_init() };
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

            let mut ar_callbacks: AUDIO_RENDERER_CALLBACKS = unsafe { MaybeUninit::zeroed().assume_init() };
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

            log::info!("LiStartConnection terminó con código: {result}");
        });

        log::info!("MoonlightClient: Stream iniciado con callbacks configurados");
        Ok(())
    }

    /// Desconecta la sesión activa de streaming, notificando al Host Sunshine y reseteando binding states.
    pub fn disconnect(&self) {
        self.is_connecting.store(false, Ordering::SeqCst);
        let was_connected = self.is_connected.swap(false, Ordering::SeqCst);

        let host_ip = self.last_host_ip.lock().ok().and_then(|mut guard| guard.take());
        let unique_id = self.get_or_create_unique_id().ok();

        if let (Some(mut target_ip), Some(id)) = (host_ip, unique_id) {
            if target_ip == "127.0.0.1" {
                target_ip = "localhost".to_string();
            }
            log::info!(
                "[MoonlightClient] Notificando /cancel al host Sunshine ({target_ip}:47984)"
            );
            tokio::spawn(async move {
                let client = reqwest::Client::builder()
                    .danger_accept_invalid_certs(true)
                    .timeout(std::time::Duration::from_secs(3))
                    .build();
                if let Ok(client) = client {
                    cancel_sunshine_session(&client, &target_ip, &id).await;
                }
            });
        }

        if was_connected {
            unsafe { LiStopConnection() };
            log::info!("[MoonlightClient] LiStopConnection ejecutado");
        }

        self.video_server.stop();
        self.webtransport_server.stop();
        reset_bindings_state();
        super::input_relay::reset_input_relay_state();

        log::info!("[MoonlightClient] Desconectado completamente y estados reseteados");
    }
}

/// Cancela cualquier sesión activa en el servidor HTTPS de Sunshine (puerto 47984).
async fn cancel_sunshine_session(client: &reqwest::Client, target_ip: &str, unique_id: &str) {
    let cancel_with_id = format!("https://{target_ip}:47984/cancel?uniqueid={unique_id}");
    let cancel_raw = format!("https://{target_ip}:47984/cancel");
    let _ = client.get(&cancel_with_id).send().await;
    let _ = client.get(&cancel_raw).send().await;
}

impl Drop for MoonlightClient {
    fn drop(&mut self) {
        self.disconnect();
    }
}

