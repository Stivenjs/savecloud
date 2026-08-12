//! # Servidor WebSocket para Transmisión de Video de Ultra-Baja Latencia (0-Lag)
//!
//! Este módulo implementa [`VideoServer`], un servidor local WebSocket en TCP alimentado por Tokio
//! diseñado para la entrega con latencia casi nula (0-Lag) de tramas de video decodificadas o encapsuladas
//! (H.264, H.265, AV1) hacia el reproductor local de SaveCloud (e.g. WebCodecs API en el Frontend).

use super::error::{StreamingError, StreamingResult};
use futures_util::{SinkExt, StreamExt};
use std::fmt::Debug;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{accept_async, WebSocketStream};

/// Servidor local WebSocket de alta eficiencia para transmitir tramas de video al reproductor del frontend.
///
/// Administra la suscripción del reproductor local, controlando la señal de parada
/// a través de un canal de difusión [`watch::Sender`].
///
/// # Struct Details
/// - `stop_tx`: Transmisor de señal de cancelación para notificar la parada del bucle de escucha.
/// - `stop_rx`: Receptor de la señal de parada duplicable para las tareas asíncronas.
#[derive(Debug)]
pub struct VideoServer {
    stop_tx: watch::Sender<bool>,
    stop_rx: watch::Receiver<bool>,
}

impl VideoServer {
    /// Crea una nueva instancia del servidor de video local en estado inactivo.
    ///
    /// Inicializa el canal de control `tokio::sync::watch` configurado en `false`.
    ///
    /// # Returns
    /// Retorna una nueva instancia de [`VideoServer`].
    ///
    /// # Examples
    /// ```rust,ignore
    /// use savecloud_desktop::streaming::video_server::VideoServer;
    ///
    /// let server = VideoServer::new();
    /// ```
    #[must_use]
    pub fn new() -> Self {
        let (stop_tx, stop_rx) = watch::channel(false);
        Self { stop_tx, stop_rx }
    }

    /// Inicia el servidor TCP y WebSocket en un puerto dinámico disponible de `127.0.0.1`.
    ///
    /// Escucha conexiones entrantes del cliente de renderizado (Frontend WebCodecs player)
    /// y retransmite en tiempo real las tramas provenientes del canal `rx`.
    ///
    /// # Arguments
    /// * `rx` - Receptor [`mpsc::Receiver<Vec<u8>>`] por el cual se reciben los fotogramas de video serializados.
    ///
    /// # Returns
    /// * `Ok(u16)` - Retorna el puerto TCP asignado dinámicamente en `127.0.0.1`.
    /// * `Err(StreamingError)` - Si ocurre un error al vincular el puerto TCP o consultar la dirección local.
    ///
    /// # Errors
    /// Retorna [`StreamingError::WebSocket`] si el puerto TCP `127.0.0.1:0` no se puede vincular
    /// o si falla la lectura de la dirección del socket local.
    ///
    /// # Latency & Performance Notes
    /// - Activa `TCP_NODELAY` en cada conexión TCP aceptada para eliminar el algoritmo de Nagle.
    /// - Purga tramas obsoletas acumuladas en `rx` mediante [`drain_stale_frames`] antes de procesar el primer IDR.
    /// - Transmite en segundo plano mediante un hilo ejecutor de Tokio de baja sobrecarga.
    pub async fn start(
        &self,
        bcast_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
    ) -> StreamingResult<u16> {
        // Resetear la señal de parada a false para permitir múltiples inicios si se reutiliza la instancia.
        let _ = self.stop_tx.send(false);

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|err| StreamingError::WebSocket(format!("Fallo al vincular socket TCP local: {err}")))?;

        let local_addr = listener
            .local_addr()
            .map_err(|err| StreamingError::WebSocket(format!("Fallo al obtener puerto local: {err}")))?;

        let port = local_addr.port();

        log::info!(
            "[VideoServer] Servidor WebSocket activo en 127.0.0.1:{} (TCP_NODELAY habilitado)",
            port
        );

        let mut stop_rx = self.stop_rx.clone();

        tokio::spawn(async move {
            run_server_loop(listener, bcast_tx, &mut stop_rx).await;
        });

        Ok(port)
    }

    /// Cancela de forma inmediata la ejecución del servidor WebSocket y cierra las conexiones activas.
    ///
    /// Envía una señal `true` a través del canal `watch::Sender` para solicitar la salida
    /// inmediata del bucle de eventos.
    ///
    /// # Examples
    /// ```rust,ignore
    /// use savecloud_desktop::streaming::video_server::VideoServer;
    ///
    /// let server = VideoServer::new();
    /// server.stop();
    /// ```
    pub fn stop(&self) {
        if let Err(err) = self.stop_tx.send(true) {
            log::warn!("[VideoServer] No se pudo enviar señal de parada (canal cerrado): {err}");
        } else {
            log::info!("[VideoServer] Señal de parada enviada con éxito");
        }
    }
}

impl Default for VideoServer {
    fn default() -> Self {
        Self::new()
    }
}

/// Bucle principal de eventos que acepta conexiones TCP y gestiona la transmisión de tramas de video.
///
/// # Arguments
/// * `listener` - Instancia de [`TcpListener`] vinculada al puerto dinámico local.
/// * `bcast_tx` - Transmisor [`broadcast::Sender<Vec<u8>>`] con el flujo de fotogramas de video.
/// * `stop_rx` - Receptor del canal `watch` para detectar la señal de parada del servidor.
///
/// # Latency & Performance Notes
/// Aplica `set_nodelay(true)` a cada socket entrante para garantizar la entrega inmediata de cada frame.
async fn run_server_loop(
    listener: TcpListener,
    bcast_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
    stop_rx: &mut watch::Receiver<bool>,
) {
    loop {
        let stream = tokio::select! {
            accept_res = listener.accept() => match accept_res {
                Ok((socket, addr)) => {
                    log::debug!("[VideoServer] Nueva conexión TCP aceptada desde {addr}");
                    socket
                }
                Err(err) => {
                    log::error!("[VideoServer] Error al aceptar conexión TCP: {err}");
                    break;
                }
            },
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    log::info!("[VideoServer] Deteniendo servidor por señal de parada");
                    break;
                }
                continue;
            }
        };

        if let Err(err) = stream.set_nodelay(true) {
            log::warn!("[VideoServer] No se pudo establecer TCP_NODELAY en el socket: {err}");
        }

        let mut ws_stream = match accept_async(stream).await {
            Ok(ws) => ws,
            Err(err) => {
                log::warn!("[VideoServer] Fallo en el handshake WebSocket: {err}");
                continue;
            }
        };

        let negotiated_codec = super::bindings::get_negotiated_video_codec_name();
        log::info!(
            "[VideoServer] Cliente WebSocket de video conectado. Códec negociado: {}",
            negotiated_codec
        );

        let mut rx = bcast_tx.subscribe();

        // Forzar la solicitud de un IDR Keyframe fresco a Sunshine para el cliente recién conectado o recargado
        super::bindings::request_idr_frame();

        // Envío de mensaje de inicialización de códec
        if let Err(err) = send_codec_init(&mut ws_stream, negotiated_codec).await {
            log::error!("[VideoServer] Fallo al enviar mensaje codec_init: {err}");
            continue;
        }

        // Purgar tramas antiguas acumuladas antes de enviar la primera trama IDR fresca
        let drained_count = drain_stale_frames(&mut rx);
        if drained_count > 0 {
            log::info!("[VideoServer] Se purgaron {drained_count} tramas de video obsoletas para evitar retardo");
        }

        // Envío del último IDR Keyframe guardado en caché si existe
        send_cached_idr(&mut ws_stream).await;

        // Bucle de retransmisión de fotogramas al cliente WebSocket conectado
        handle_client_stream(&mut ws_stream, &mut rx, stop_rx).await;
    }
}

/// Envía el mensaje inicial `codec_init` con el códec negociado hacia el cliente WebSocket.
///
/// # Arguments
/// * `ws_stream` - Referencia mutable al flujo WebSocket activo [`WebSocketStream<TcpStream>`].
/// * `codec_name` - Nombre del códec negociado (e.g., "h264", "h265", "av1").
///
/// # Errors
/// Retorna `Err` si falla el envío a través del flujo WebSocket.
async fn send_codec_init(
    ws_stream: &mut WebSocketStream<TcpStream>,
    codec_name: &str,
) -> Result<(), tokio_tungstenite::tungstenite::Error> {
    let payload = format!(r#"{{"type":"codec_init","codec":"{codec_name}"}}"#);
    ws_stream.send(Message::Text(payload.into())).await
}

/// Purga de manera no bloqueante las tramas de video atascadas en el canal.
///
/// # Arguments
/// * `rx` - Referencia mutable al receptor del canal broadcast.
///
/// # Returns
/// Retorna la cantidad de tramas purgadas.
///
/// # Latency & Performance Notes
/// Previene la acumulación de retraso (*buffer bloat*) cuando el reproductor local se conecta o reconecta.
fn drain_stale_frames(rx: &mut tokio::sync::broadcast::Receiver<Vec<u8>>) -> usize {
    let mut count = 0;
    while rx.try_recv().is_ok() {
        count += 1;
    }
    count
}

/// Envía el último IDR Keyframe almacenado en caché si se encuentra disponible.
///
/// # Arguments
/// * `ws_stream` - Referencia mutable al flujo WebSocket activo.
async fn send_cached_idr(ws_stream: &mut WebSocketStream<TcpStream>) {
    let cached_idr = super::bindings::LAST_IDR_FRAME
        .lock()
        .ok()
        .and_then(|guard| guard.clone());

    if let Some(idr_payload) = cached_idr {
        log::info!(
            "[VideoServer] Enviando IDR Keyframe en caché ({} bytes) al cliente WebSocket",
            idr_payload.len()
        );
        if let Err(err) = ws_stream
            .send(Message::Binary((*idr_payload).clone().into()))
            .await
        {
            log::error!("[VideoServer] Error al enviar IDR Keyframe en caché: {err}");
        }
    }
}

/// Maneja la retransmisión continua de fotogramas de video hacia un cliente WebSocket conectado.
///
/// # Arguments
/// * `ws_stream` - Referencia mutable al flujo WebSocket activo.
/// * `rx` - Referencia mutable al receptor del canal de tramas de video.
/// * `stop_rx` - Referencia mutable al receptor de la señal de parada del servidor.
async fn handle_client_stream(
    ws_stream: &mut WebSocketStream<TcpStream>,
    rx: &mut tokio::sync::broadcast::Receiver<Vec<u8>>,
    stop_rx: &mut watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    log::info!("[VideoServer] Señal de parada detectada durante transmisión a cliente");
                    break;
                }
            }
            frame_res = rx.recv() => {
                match frame_res {
                    Ok(data) => {
                        if let Err(err) = ws_stream.send(Message::Binary(data.into())).await {
                            log::error!("[VideoServer] Error al transmitir trama de video por WebSocket: {err}");
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                        log::debug!("[VideoServer] Cliente WebSocket atrasado {count} tramas");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        log::info!("[VideoServer] Canal de video de entrada cerrado");
                        return;
                    }
                }
            }
            msg_opt = ws_stream.next() => {
                let Some(msg_result) = msg_opt else {
                    log::info!("[VideoServer] Cliente WebSocket se desconectó");
                    break;
                };
                match msg_result {
                    Ok(Message::Close(_)) => {
                        log::info!("[VideoServer] Cliente WebSocket solicitó cierre de sesión (Close)");
                        break;
                    }
                    Err(err) => {
                        log::warn!("[VideoServer] Error en lectura de mensaje WebSocket: {err}");
                        break;
                    }
                    _ => {}
                }
            }
        }
    }
}

