//! Lógica de bajo nivel para el cliente WebSocket de SaveCloud.
//!
//! Este archivo gestiona la conexión cruda, el handshake TLS y el bucle de eventos
//! de lectura/escritura para comunicarse con el servidor AWS WebSocket.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;

/// Mensajes que el cliente puede recibir desde el servidor de la nube.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CloudIncomingMessage {
    /// Un amigo ha comenzado a jugar a algo.
    FriendPlaying { data: FriendPlayingData },
    /// Un error reportado por el servidor.
    Error { data: ErrorData },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FriendPlayingData {
    pub friend_user_id: String,
    pub game_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ErrorData {
    pub message: String,
}

/// Mensajes de salida que enviamos al servidor (broadcasts).
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloudBroadcastPayload {
    pub action: String,
    pub broadcaster_user_id: String,
    pub game_id: String,
    pub game_name: String,
}

/// Inicia el bucle de conexión WebSocket en un hilo de fondo.
///
/// # Arguments
/// * `app_handle` - Instancia de Tauri para emitir eventos al frontend.
/// * `url_str` - URL completa del WebSocket (con apiKey/token ya incluidos).
/// * `rx` - Canal de recepción de mensajes de salida desde el frontend.
pub async fn start_ws_loop(
    app_handle: AppHandle,
    url_str: String,
    mut rx: mpsc::UnboundedReceiver<CloudBroadcastPayload>,
) {
    let _url = match Url::parse(&url_str) {
        Ok(u) => u,
        Err(e) => {
            log_error(&app_handle, &format!("URL inválida: {}", e));
            return;
        }
    };

    let mut backoff = Duration::from_secs(2);

    loop {
        match connect_async(url_str.as_str()).await {
            Ok((ws_stream, _)) => {
                backoff = Duration::from_secs(2); // Reset backoff

                let (mut ws_sender, mut ws_receiver) = ws_stream.split();

                loop {
                    tokio::select! {
                        // 1. Mensajes entrantes del servidor
                        Some(msg) = ws_receiver.next() => {
                            match msg {
                                Ok(Message::Text(text)) => {
                                    println!("[CloudWS] RAW RECEIVED: {}", text);
                                    match serde_json::from_str::<CloudIncomingMessage>(&text) {
                                        Ok(incoming) => {
                                            println!("[CloudWS] Successfully parsed: {:?}", incoming);
                                            match app_handle.emit("cloud-ws-incoming", &incoming) {
                                                Ok(_) => println!("[CloudWS] Event emitted to frontend"),
                                                Err(e) => println!("[CloudWS] ERROR emitting event: {}", e),
                                            }
                                        }
                                        Err(e) => {
                                            println!("[CloudWS] JSON PARSE ERROR: {}. Target text: {}", e, text);
                                        }
                                    }
                                }
                                Ok(Message::Close(_)) => {
                                    println!("[CloudWS] Connection closed by server");
                                    break;
                                }
                                Err(e) => {
                                    println!("[CloudWS] Network error: {}", e);
                                    break;
                                }
                                _ => {}
                            }
                        }

                        // 2. Mensajes salientes de la UI (broadcasts)
                        Some(payload) = rx.recv() => {
                            if let Ok(text) = serde_json::to_string(&payload) {
                                let _ = ws_sender.send(Message::Text(text.into())).await;
                            }
                        }
                    }
                }
            }
            Err(e) => {
                println!(
                    "[CloudWS] Error conectando: {}. Reintentando en {}s...",
                    e,
                    backoff.as_secs()
                );
            }
        }

        // Reintento con backoff exponencial
        tokio::time::sleep(backoff).await;
        backoff = std::cmp::min(backoff * 2, Duration::from_secs(60));
    }
}

/// Helper para registrar errores en la consola.
fn log_error(_handle: &AppHandle, msg: &str) {
    eprintln!("[CloudWS] ERROR: {}", msg);
}
