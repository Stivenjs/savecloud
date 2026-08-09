//! Servidor WebSocket para la transmisión de video con latencia ultra baja (0-Lag).

use super::error::{StreamingError, StreamingResult};
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;

/// Servidor local WebSocket de alta eficiencia para entregar tramas H.264/H.265 al reproductor.
pub struct VideoServer {
    stop_tx: watch::Sender<bool>,
    stop_rx: watch::Receiver<bool>,
}

impl VideoServer {
    #[must_use]
    pub fn new() -> Self {
        let (stop_tx, stop_rx) = watch::channel(false);
        Self { stop_tx, stop_rx }
    }

    /// Inicia el servidor TCP/WebSocket en un puerto dinámico disponible de 127.0.0.1.
    pub async fn start(&self, mut rx: mpsc::Receiver<Vec<u8>>) -> StreamingResult<u16> {
        let _ = self.stop_tx.send(false);

        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| StreamingError::WebSocket(format!("Fallo al vincular TCP: {e}")))?;

        let port = listener
            .local_addr()
            .map_err(|e| StreamingError::WebSocket(e.to_string()))?
            .port();

        log::info!(
            "[VideoServer] Servidor WebSocket activo en 127.0.0.1:{}",
            port
        );

        let mut stop_rx = self.stop_rx.clone();

        tokio::spawn(async move {
            loop {
                let (stream, _addr) = tokio::select! {
                    res = listener.accept() => match res {
                        Ok(conn) => conn,
                        Err(e) => {
                            log::error!("[VideoServer] Error aceptando conexión TCP: {e}");
                            break;
                        }
                    },
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            log::info!("[VideoServer] Señal de parada recibida");
                            break;
                        }
                        continue;
                    }
                };

                let Ok(mut ws_stream) = accept_async(stream).await else {
                    log::warn!("[VideoServer] Fallo en handshake WebSocket");
                    continue;
                };

                let negotiated_codec = super::bindings::get_negotiated_video_codec_name();
                log::info!(
                    "[VideoServer] Cliente de video WebSocket conectado. Códec negociado: {}",
                    negotiated_codec
                );

                let init_payload = serde_json::json!({
                    "type": "codec_init",
                    "codec": negotiated_codec
                })
                .to_string();

                if let Err(e) = ws_stream.send(Message::Text(init_payload.into())).await {
                    log::error!("[VideoServer] Error al enviar mensaje codec_init: {e}");
                }

                let cached_idr = super::bindings::LAST_IDR_FRAME
                    .lock()
                    .ok()
                    .and_then(|guard| guard.clone());

                if let Some(idr_payload) = cached_idr {
                    log::info!(
                        "[VideoServer] Enviando IDR Keyframe en caché ({} bytes) al nuevo cliente WebSocket",
                        idr_payload.len()
                    );
                    if let Err(e) = ws_stream.send(Message::Binary(idr_payload.into())).await {
                        log::error!("[VideoServer] Error al enviar IDR Keyframe en caché: {e}");
                    }
                }

                loop {
                    tokio::select! {
                        _ = stop_rx.changed() => {
                            if *stop_rx.borrow() {
                                break;
                            }
                        }
                        frame = rx.recv() => {
                            let Some(data) = frame else {
                                log::info!("[VideoServer] Canal de video cerrado");
                                return;
                            };
                            if let Err(e) = ws_stream.send(Message::Binary(data.into())).await {
                                log::error!("[VideoServer] Error al enviar trama por WebSocket: {e}");
                                break;
                            }
                        }
                        msg = ws_stream.next() => {
                            let Some(msg_result) = msg else {
                                log::info!("[VideoServer] Conexión WebSocket finalizada");
                                break;
                            };
                            if matches!(msg_result, Ok(Message::Close(_))) {
                                log::info!("[VideoServer] Cliente WebSocket envió Close");
                                break;
                            }
                        }
                    }
                }
            }
        });

        Ok(port)
    }

    /// Cancela inmediatamente el servidor WebSocket y cierra la escucha de red.
    pub fn stop(&self) {
        let _ = self.stop_tx.send(true);
    }
}

impl Default for VideoServer {
    fn default() -> Self {
        Self::new()
    }
}
