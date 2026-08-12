//! # Servidor WebTransport / QUIC (HTTP/3 Datagrams UDP)
//!
//! Este módulo implementa [`WebTransportServer`], un servidor QUIC basado en `wtransport` (HTTP/3 sobre UDP)
//! diseñado para la entrega de tramas de video y audio con cero bloqueo de cabecera (*Head-of-Line Blocking*).
//!
//! Utiliza certificados TLS 1.3 autofirmados generados dinámicamente en memoria y calcula la huella
//! digital SHA-256 para permitir la conexión segura del navegador mediante la W3C WebTransport API (`serverCertificateHashes`).

use super::error::{StreamingError, StreamingResult};
use std::fmt::Debug;
use tokio::sync::{broadcast, watch};
use wtransport::config::ServerConfig;
use wtransport::endpoint::endpoint_side::Server;
use wtransport::{Endpoint, Identity};

/// Información sobre el punto de enlace de WebTransport iniciado.

#[derive(Debug, Clone)]
pub struct WebTransportServerInfo {
    /// Puerto UDP asignado dinámicamente.
    pub port: u16,
    /// Huella digital SHA-256 del certificado TLS autofirmado (32 bytes).
    pub cert_hash: Vec<u8>,
    /// Representación hexadecimal de la huella digital SHA-256.
    pub cert_hash_hex: String,
}

impl WebTransportServerInfo {
    /// Devuelve los bytes de la huella digital SHA-256 del certificado TLS.
    pub fn cert_hash(&self) -> &[u8] {
        &self.cert_hash
    }
}

/// Servidor WebTransport sobre QUIC UDP para streaming sin bloqueo de cabecera.
///
/// Administra el ciclo de vida del servidor HTTP/3, la escucha en sockets UDP y el envío
/// de datagramas no confiables (*unreliable datagrams*) para video y audio en tiempo real.
#[allow(dead_code)]
#[derive(Debug)]
pub struct WebTransportServer {
    stop_tx: watch::Sender<bool>,
    stop_rx: watch::Receiver<bool>,
}

#[allow(dead_code)]
impl WebTransportServer {
    /// Crea una nueva instancia del servidor WebTransport en estado inactivo.
    ///
    /// # Returns
    /// Retorna una nueva instancia de [`WebTransportServer`].
    #[must_use]
    pub fn new() -> Self {
        let (stop_tx, stop_rx) = watch::channel(false);
        Self { stop_tx, stop_rx }
    }

    /// Inicia el servidor WebTransport sobre un puerto UDP dinámico en `127.0.0.1`.
    ///
    /// Genera un certificado TLS 1.3 autofirmado dinámico, extrae la huella SHA-256
    /// y comienza a escuchar conexiones QUIC entrantes para transmitir tramas de video/audio mediante UDP Datagrams.
    ///
    /// # Arguments
    /// * `rx` - Receptor [`mpsc::Receiver<Vec<u8>>`] con las tramas serializadas de video/audio.
    ///
    /// # Returns
    /// * `Ok(WebTransportServerInfo)` - Información de puerto UDP y huella digital SHA-256 para la API del navegador.
    /// * `Err(StreamingError)` - Si ocurre un error al generar el certificado o abrir el socket UDP.
    ///
    /// # Errors
    /// Retorna [`StreamingError::WebSocket`] o [`StreamingError::Io`] si falla la configuración de `wtransport`.
    pub async fn start(&self, bcast_tx: broadcast::Sender<Vec<u8>>) -> StreamingResult<WebTransportServerInfo> {
        let _ = self.stop_tx.send(false);

        // Generación de identidad TLS 1.3 autofirmada efímera para WebTransport
        let identity = Identity::self_signed(["localhost", "127.0.0.1", "localhost:0"])
            .map_err(|err| StreamingError::WebSocket(format!("Fallo al generar certificado TLS para WebTransport: {err}")))?;

        // Extracción de la huella digital SHA-256 del certificado TLS para la validación en el cliente W3C WebTransport API
        let cert_hash = identity.certificate_chain().as_slice()[0].hash().as_ref().to_vec();
        let cert_hash_hex = hex::encode(&cert_hash);

        // Configuración del servidor WebTransport QUIC
        let config = ServerConfig::builder()
            .with_bind_default(0)
            .with_identity(identity)
            .build();

        let endpoint = Endpoint::server(config)
            .map_err(|err| StreamingError::WebSocket(format!("Fallo al crear Endpoint WebTransport QUIC: {err}")))?;

        let local_addr = endpoint
            .local_addr()
            .map_err(|err| StreamingError::WebSocket(format!("Fallo al consultar dirección local UDP: {err}")))?;

        let port = local_addr.port();

        log::info!(
            "[WebTransportServer] Servidor HTTP/3 QUIC activo en UDP 127.0.0.1:{} (SHA-256 cert: {})",
            port,
            &cert_hash_hex[..12]
        );

        let mut stop_rx = self.stop_rx.clone();

        tokio::spawn(async move {
            run_webtransport_loop(endpoint, bcast_tx, &mut stop_rx).await;
        });

        Ok(WebTransportServerInfo {
            port,
            cert_hash,
            cert_hash_hex,
        })
    }

    /// Envía una señal de parada al servidor WebTransport.
    pub fn stop(&self) {
        if let Err(err) = self.stop_tx.send(true) {
            log::warn!("[WebTransportServer] No se pudo enviar señal de parada (canal cerrado): {err}");
        } else {
            log::info!("[WebTransportServer] Señal de parada enviada exitosamente");
        }
    }
}

impl Default for WebTransportServer {
    fn default() -> Self {
        Self::new()
    }
}

const CHUNK_PAYLOAD_SIZE: usize = 1024;
static FRAME_SEQ: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);

fn send_chunked_frame(
    connection: &wtransport::Connection,
    frame: &[u8],
) -> Result<(), wtransport::error::SendDatagramError> {
    if frame.is_empty() {
        return Ok(());
    }

    let msg_type = frame[0];
    let payload = &frame[1..];
    let seq = FRAME_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let total_chunks = if payload.is_empty() {
        1
    } else {
        ((payload.len() as f64) / (CHUNK_PAYLOAD_SIZE as f64)).ceil() as usize
    };

    if total_chunks > 255 {
        log::warn!(
            "[WebTransportServer] Fotograma demasiado grande para datagramas UDP ({} bytes), omitiendo.",
            frame.len()
        );
        return Ok(());
    }

    let total_chunks_u8 = total_chunks as u8;

    for chunk_idx in 0..total_chunks {
        let start = chunk_idx * CHUNK_PAYLOAD_SIZE;
        let end = (start + CHUNK_PAYLOAD_SIZE).min(payload.len());
        let chunk_data = if payload.is_empty() { &[] } else { &payload[start..end] };

        // Encabezado de 5 bytes: [msgType, seq_hi, seq_lo, chunkIdx, totalChunks]
        let mut packet = Vec::with_capacity(5 + chunk_data.len());
        packet.push(msg_type);
        packet.extend_from_slice(&seq.to_be_bytes());
        packet.push(chunk_idx as u8);
        packet.push(total_chunks_u8);
        packet.extend_from_slice(chunk_data);

        connection.send_datagram(&packet)?;
    }

    Ok(())
}

/// Bucle asíncrono principal que acepta conexiones WebTransport y transmite datagramas UDP.
///
/// # Arguments
/// * `endpoint` - Instancia de [`Endpoint<wtransport::endpoint::Server>`] escuchando en el puerto UDP asignado.
/// * `bcast_tx` - Transmisor [`broadcast::Sender<Vec<u8>>`] con las tramas serializadas.
/// * `stop_rx` - Receptor del canal `watch` para detectar la parada del servidor.
#[allow(dead_code)]
async fn run_webtransport_loop(
    endpoint: Endpoint<Server>,
    bcast_tx: broadcast::Sender<Vec<u8>>,
    stop_rx: &mut watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            incoming_session = endpoint.accept() => {
                let bcast_tx_clone = bcast_tx.clone();
                let mut stop_rx_child = stop_rx.clone();

                tokio::spawn(async move {
                    match incoming_session.await {
                        Ok(session_request) => {
                            match session_request.accept().await {
                                Ok(connection) => {
                                    log::info!("[WebTransportServer] Cliente WebTransport conectado exitosamente.");
                                    let mut rx = bcast_tx_clone.subscribe();

                                    // Forzar la solicitud de un IDR Keyframe fresco a Sunshine
                                    super::bindings::request_idr_frame();

                                    // Enviar el último IDR Keyframe guardado en caché si existe
                                    if let Ok(guard) = super::bindings::LAST_IDR_FRAME.lock() {
                                        if let Some(idr_payload) = guard.as_ref() {
                                            log::info!(
                                                "[WebTransportServer] Enviando IDR Keyframe en caché ({} bytes) al cliente WebTransport recién conectado",
                                                idr_payload.len()
                                            );
                                            let _ = send_chunked_frame(&connection, idr_payload);
                                        }
                                    }

                                    loop {
                                        tokio::select! {
                                            frame_res = rx.recv() => {
                                                match frame_res {
                                                    Ok(frame) => {
                                                        // Fragmentación de seguridad en datagramas MTU (1024 bytes)
                                                        if let Err(err) = send_chunked_frame(&connection, &frame) {
                                                            log::debug!("[WebTransportServer] Error al enviar datagrama UDP (cliente desconectado): {err}");
                                                            break;
                                                        }
                                                    }
                                                    Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                                                        log::debug!("[WebTransportServer] Cliente WebTransport atrasado {count} tramas");
                                                    }
                                                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                                                }
                                            }
                                            _ = stop_rx_child.changed() => {
                                                if *stop_rx_child.borrow() {
                                                    log::info!("[WebTransportServer] Parando sesión WebTransport.");
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                                Err(err) => {
                                    log::warn!("[WebTransportServer] Fallo al aceptar sesión WebTransport: {err}");
                                }
                            }
                        }
                        Err(err) => {
                            log::warn!("[WebTransportServer] Error al negociar handshake QUIC/WebTransport: {err}");
                        }
                    }
                });
            }
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    log::info!("[WebTransportServer] Finalizando bucle de eventos WebTransport.");
                    break;
                }
            }
        }
    }
}
