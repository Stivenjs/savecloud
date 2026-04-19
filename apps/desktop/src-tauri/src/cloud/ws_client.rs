//! Lógica de bajo nivel para el cliente WebSocket de SaveCloud.
//!
//! Este archivo gestiona la conexión cruda, el handshake TLS y el bucle de eventos
//! de lectura/escritura para comunicarse con el servidor AWS WebSocket.

use crate::commands::logs::sync_logger;
use crate::plugins::log_buffer::{AppLogs, LogEntry};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
    /// Cambio de presencia explícito (online/playing).
    PresenceUpdate { data: PresenceUpdateData },
    /// Un error reportado por el servidor.
    Error { data: ErrorData },
    /// Evento de signaling para sesiones de streaming P2P.
    StreamSignal { data: StreamSignalData },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FriendPlayingData {
    pub friend_user_id: String,
    pub game_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresenceUpdateData {
    pub user_id: String,
    pub status: String,
    pub game_id: Option<String>,
    pub game_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ErrorData {
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamSignalData {
    pub from_user_id: String,
    pub target_user_id: Option<String>,
    pub event: String,
    pub stream_id: String,
    pub payload: Option<Value>,
    pub timestamp: u64,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloudStreamSignalPayload {
    pub action: String,
    #[serde(rename = "type")]
    pub message_type: String,
    pub event: String,
    pub stream_id: String,
    pub target_user_id: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone)]
pub enum CloudOutgoingMessage {
    Broadcast(CloudBroadcastPayload),
    StreamSignal(CloudStreamSignalPayload),
}

/// Inicia el bucle de conexión WebSocket en un hilo de fondo.
///
/// # Arguments
/// * `app_handle` - Instancia de Tauri para emitir eventos al frontend.
/// * `url_str` - URL completa del WebSocket (con apiKey/token ya incluidos).
/// * `rx` - Canal de recepción de mensajes de salida desde el frontend.
/// * `logs` - Buffer de logs en memoria para el usuario.
pub async fn start_ws_loop(
    app_handle: AppHandle,
    url_str: String,
    mut rx: mpsc::UnboundedReceiver<CloudOutgoingMessage>,
    logs: AppLogs,
) {
    let _url = match Url::parse(&url_str) {
        Ok(u) => u,
        Err(e) => {
            log_cloud(&app_handle, &logs, "error", &format!("URL inválida: {}", e)).await;
            return;
        }
    };

    let mut backoff = Duration::from_secs(2);

    loop {
        match connect_async(url_str.as_str()).await {
            Ok((ws_stream, _)) => {
                backoff = Duration::from_secs(2); // Reset backoff
                log_cloud(
                    &app_handle,
                    &logs,
                    "info",
                    "Conexión WebSocket establecida con éxito.",
                )
                .await;

                let (mut ws_sender, mut ws_receiver) = ws_stream.split();

                loop {
                    tokio::select! {
                        // 1. Mensajes entrantes del servidor
                        Some(msg) = ws_receiver.next() => {
                            match msg {
                                Ok(Message::Text(text)) => {
                                    let text_preview: String = text.chars().take(220).collect();
                                    sync_logger::log_operation(
                                        "cloud_ws_text_received",
                                        &format!("payloadPreview={}", text_preview),
                                    );

                                    match serde_json::from_str::<CloudIncomingMessage>(&text) {
                                        Ok(incoming) => {
                                            if let CloudIncomingMessage::FriendPlaying { data } = &incoming {
                                                log_cloud(&app_handle, &logs, "info", &format!("Amigo jugando: {} a {}", data.friend_user_id, data.game_name)).await;
                                                sync_logger::log_operation(
                                                    "cloud_ws_friend_playing_received",
                                                    &format!(
                                                        "friendUserId={} gameName={}",
                                                        data.friend_user_id,
                                                        data.game_name
                                                    ),
                                                );

                                                // Fallback robusto: disparar overlay desde Rust sin depender del puente TS.
                                                let _ = crate::overlay::show_overlay_notification(
                                                    app_handle.clone(),
                                                    "Amigo jugando".to_string(),
                                                    format!("{} esta jugando {}", data.friend_user_id, data.game_name),
                                                )
                                                .await;
                                            }

                                            let msg_kind = match &incoming {
                                                CloudIncomingMessage::FriendPlaying { .. } => "FRIEND_PLAYING",
                                                CloudIncomingMessage::PresenceUpdate { .. } => "PRESENCE_UPDATE",
                                                CloudIncomingMessage::Error { .. } => "ERROR",
                                                CloudIncomingMessage::StreamSignal { .. } => "STREAM_SIGNAL",
                                            };

                                            sync_logger::log_operation(
                                                "cloud_ws_message_parsed",
                                                &format!("kind={}", msg_kind),
                                            );

                                            match app_handle.emit("cloud-ws-incoming", &incoming) {
                                                Ok(_) => sync_logger::log_operation(
                                                    "cloud_ws_emit_to_frontend_ok",
                                                    &format!("kind={}", msg_kind),
                                                ),
                                                Err(e) => sync_logger::log_error(
                                                    "cloud_ws_emit_to_frontend_error",
                                                    &format!("kind={}", msg_kind),
                                                    &e.to_string(),
                                                ),
                                            }
                                        }
                                        Err(e) => {
                                            sync_logger::log_error(
                                                "cloud_ws_parse_error",
                                                "No se pudo parsear payload websocket",
                                                &e.to_string(),
                                            );
                                        }
                                    }
                                }
                                Ok(Message::Close(_)) => {
                                    log_cloud(&app_handle, &logs, "info", "Conexión cerrada por el servidor.").await;
                                    break;
                                }
                                Err(e) => {
                                    log_cloud(&app_handle, &logs, "error", &format!("Error de red: {}", e)).await;
                                    break;
                                }
                                _ => {}
                            }
                        }

                        // 2. Mensajes salientes de la UI (broadcasts)
                        Some(outgoing) = rx.recv() => {
                            let serialized = match outgoing {
                                CloudOutgoingMessage::Broadcast(payload) => serde_json::to_string(&payload),
                                CloudOutgoingMessage::StreamSignal(payload) => serde_json::to_string(&payload),
                            };

                            if let Ok(text) = serialized {
                                if let Err(e) = ws_sender.send(Message::Text(text.into())).await {
                                    log_cloud(&app_handle, &logs, "error", &format!("Error enviando broadcast: {}", e)).await;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                log_cloud(
                    &app_handle,
                    &logs,
                    "error",
                    &format!("Error conectando: {}. Reintentando...", e),
                )
                .await;
            }
        }

        // Reintento con backoff exponencial
        tokio::time::sleep(backoff).await;
        backoff = std::cmp::min(backoff * 2, Duration::from_secs(60));
    }
}

/// Helper para añadir logs al sistema interno de SaveCloud.
async fn log_cloud(handle: &AppHandle, logs: &AppLogs, level: &str, message: &str) {
    let entry = LogEntry {
        timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
        level: level.to_string(),
        plugin: "Cloud".to_string(),
        message: message.to_string(),
    };

    // 1. Guardar en el buffer persistente en memoria
    logs.lock().await.push(entry.clone());

    // 2. Emitir a la UI para que se vea en tiempo real
    let _ = handle.emit("plugin_log", entry);
}
