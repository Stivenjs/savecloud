//! Lógica de bajo nivel para el cliente WebSocket de SaveCloud.

use crate::commands::logs::sync_logger;
use crate::plugins::log_buffer::{AppLogs, LogEntry};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
use url::Url;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CloudIncomingMessage {
    FriendPlaying { data: FriendPlayingData },
    PresenceUpdate { data: PresenceUpdateData },
    Error { data: ErrorData },
    StreamSignal { data: StreamSignalData },
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FriendPlayingData {
    pub friend_user_id: String,
    pub game_name: String,
    #[serde(default)]
    pub game_id: String,
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

/// Métricas runtime del cliente WebSocket (panel de observabilidad).
#[derive(Clone, Default, Debug)]
pub struct WsRuntimeMetrics {
    pub connected: bool,
    pub last_connected_at_ms: Option<i64>,
    pub last_disconnected_at_ms: Option<i64>,
    pub last_error: Option<String>,
    pub last_error_at_ms: Option<i64>,
    pub total_successful_connections: u64,
}

fn utc_now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Inicia el bucle de conexión WebSocket en un hilo de fondo.
///
/// # Arguments
/// * `app_handle`    - Instancia de Tauri para emitir eventos al frontend.
/// * `url_str`       - URL completa del WebSocket (con apiKey/token ya incluidos).
/// * `rx`            - Canal de recepción de mensajes de salida desde el frontend.
/// * `logs`          - Buffer de logs en memoria para el usuario.
/// * `ready_notify`  - Sender one-shot consumido una sola vez cuando la primera
///                     conexión exitosa se establece. Permite al manager drenar
///                     la cola de mensajes pendientes del cold start.
/// * `metrics`       - Opcional: actualiza totales de conexión / errores para el panel de salud.
pub async fn start_ws_loop(
    app_handle: AppHandle,
    url_str: String,
    mut rx: mpsc::UnboundedReceiver<CloudOutgoingMessage>,
    logs: AppLogs,
    mut ready_notify: Option<oneshot::Sender<()>>,
    metrics: Option<Arc<Mutex<WsRuntimeMetrics>>>,
) {
    let _url = match Url::parse(&url_str) {
        Ok(u) => u,
        Err(e) => {
            log_cloud(&app_handle, &logs, "error", &format!("URL inválida: {}", e)).await;
            if let Some(ref m) = metrics {
                let mut g = m.lock().await;
                g.connected = false;
                g.last_error = Some(format!("URL inválida: {}", e));
                g.last_error_at_ms = Some(utc_now_ms());
            }
            return;
        }
    };

    let mut backoff = Duration::from_secs(2);

    // Mapa de deduplicación: friendUserId → último gameId notificado con overlay.
    // Se resetea en cada reconexión para que, si el amigo estaba jugando cuando
    // perdimos la conexión, volvamos a notificar al reconectar.
    let mut last_friend_game: HashMap<String, String> = HashMap::new();

    loop {
        match connect_async(url_str.as_str()).await {
            Ok((ws_stream, _)) => {
                backoff = Duration::from_secs(2);

                // Resetear deduplicación en cada nueva conexión.
                last_friend_game.clear();

                log_cloud(
                    &app_handle,
                    &logs,
                    "info",
                    "Conexión WebSocket establecida con éxito.",
                )
                .await;

                if let Some(ref m) = metrics {
                    let mut g = m.lock().await;
                    g.connected = true;
                    g.last_connected_at_ms = Some(utc_now_ms());
                    g.total_successful_connections =
                        g.total_successful_connections.saturating_add(1);
                }

                // Se consume solo la primera vez (Option::take); en reconexiones
                // el canal ya no existe y esto es un no-op.
                if let Some(tx) = ready_notify.take() {
                    let _ = tx.send(());
                }

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
                                                log_cloud(
                                                    &app_handle,
                                                    &logs,
                                                    "info",
                                                    &format!(
                                                        "Amigo jugando: {} a {}",
                                                        data.friend_user_id, data.game_name
                                                    ),
                                                )
                                                .await;

                                                sync_logger::log_operation(
                                                    "cloud_ws_friend_playing_received",
                                                    &format!(
                                                        "friendUserId={} gameId={} gameName={}",
                                                        data.friend_user_id,
                                                        data.game_id,
                                                        data.game_name
                                                    ),
                                                );

                                                let already_notified = last_friend_game
                                                    .get(&data.friend_user_id)
                                                    .map(|prev_id| prev_id == &data.game_id)
                                                    .unwrap_or(false);

                                                if !already_notified && !data.game_id.is_empty() {
                                                    last_friend_game.insert(
                                                        data.friend_user_id.clone(),
                                                        data.game_id.clone(),
                                                    );

                                                    let _ = crate::overlay::show_overlay_notification(
                                                        app_handle.clone(),
                                                        "Amigo jugando".to_string(),
                                                        format!(
                                                            "{} está jugando {}",
                                                            data.friend_user_id, data.game_name
                                                        ),
                                                    )
                                                    .await;
                                                } else if data.game_id.is_empty() {
                                                    last_friend_game.remove(&data.friend_user_id);
                                                }
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
                                    log_cloud(
                                        &app_handle,
                                        &logs,
                                        "info",
                                        "Conexión cerrada por el servidor.",
                                    )
                                    .await;
                                    if let Some(ref m) = metrics {
                                        let mut g = m.lock().await;
                                        g.connected = false;
                                        g.last_disconnected_at_ms = Some(utc_now_ms());
                                    }
                                    break;
                                }
                                Err(e) => {
                                    log_cloud(
                                        &app_handle,
                                        &logs,
                                        "error",
                                        &format!("Error de red: {}", e),
                                    )
                                    .await;
                                    if let Some(ref m) = metrics {
                                        let mut g = m.lock().await;
                                        g.connected = false;
                                        g.last_disconnected_at_ms = Some(utc_now_ms());
                                        g.last_error = Some(format!("recv: {}", e));
                                        g.last_error_at_ms = Some(utc_now_ms());
                                    }
                                    break;
                                }
                                _ => {}
                            }
                        }

                        Some(outgoing) = rx.recv() => {
                            let serialized = match outgoing {
                                CloudOutgoingMessage::Broadcast(payload) => {
                                    serde_json::to_string(&payload)
                                }
                                CloudOutgoingMessage::StreamSignal(payload) => {
                                    serde_json::to_string(&payload)
                                }
                            };

                            if let Ok(text) = serialized {
                                if let Err(e) = ws_sender.send(Message::Text(text.into())).await {
                                    log_cloud(
                                        &app_handle,
                                        &logs,
                                        "error",
                                        &format!("Error enviando broadcast: {}", e),
                                    )
                                    .await;
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
                if let Some(ref m) = metrics {
                    let mut g = m.lock().await;
                    g.connected = false;
                    g.last_error = Some(format!("connect: {}", e));
                    g.last_error_at_ms = Some(utc_now_ms());
                }
            }
        }

        tokio::time::sleep(backoff).await;
        backoff = std::cmp::min(backoff * 2, Duration::from_secs(60));
    }
}

async fn log_cloud(handle: &AppHandle, logs: &AppLogs, level: &str, message: &str) {
    let entry = LogEntry {
        timestamp: chrono::Local::now().format("%H:%M:%S").to_string(),
        level: level.to_string(),
        plugin: "Cloud".to_string(),
        message: message.to_string(),
    };

    logs.lock().await.push(entry.clone());
    let _ = handle.emit("plugin_log", entry);
}
