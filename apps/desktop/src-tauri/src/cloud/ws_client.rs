//! Lógica de red de bajo nivel para el cliente WebSocket de SaveCloud.
//!
//! Este módulo gestiona el ciclo de vida de la conexión WebSocket con la nube,
//! incluyendo el bucle de reconexión con backoff exponencial, el envío de *Ping/Pong*
//! de mantenimiento (Keep-Alive), el des-serializado de mensajes entrantes y la
//! emisión de eventos hacia el frontend de Tauri.

use crate::commands::logs::sync_logger;
use crate::plugins::log_buffer::{AppLogs, LogEntry};
use futures_util::{stream::SplitSink, SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio_tungstenite::{
    connect_async, tungstenite::protocol::Message, MaybeTlsStream, WebSocketStream,
};
use url::Url;

/// Intervalo en segundos para el envío de tramas `Ping` de Keep-Alive.
const PING_INTERVAL_SECS: u64 = 25;

/// Tiempo base de reconexión en segundos.
const INITIAL_BACKOFF_SECS: u64 = 2;

/// Tiempo máximo de reconexión con backoff en segundos.
const MAX_BACKOFF_SECS: u64 = 60;

/// Tipo alias para el Sink de envío WebSocket.
type WsSender = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

/// Mensaje entrante parseado desde el servidor WebSocket de la nube.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CloudIncomingMessage {
    /// Notificación de un amigo iniciando o jugando un título.
    FriendPlaying { data: FriendPlayingData },
    /// Actualización de presencia global de usuario.
    PresenceUpdate { data: PresenceUpdateData },
    /// Error emitido por el servidor backend.
    Error { data: ErrorData },
    /// Señalización WebRTC / streaming entre pares.
    StreamSignal { data: StreamSignalData },
    /// Notificación de sesión de transferencia de guardados LAN pendiente.
    TransferSessionPending { data: TransferSessionPendingData },
}

/// Datos asociados a un evento `FriendPlaying`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FriendPlayingData {
    /// ID del usuario amigo emisor.
    pub friend_user_id: String,
    /// Nombre descriptivo del juego.
    pub game_name: String,
    /// ID único del juego.
    #[serde(default)]
    pub game_id: String,
}

/// Datos asociados a un evento `PresenceUpdate`.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PresenceUpdateData {
    /// ID del usuario emisor.
    pub user_id: String,
    /// Estado del usuario ("online", "playing", etc.).
    pub status: String,
    /// ID del juego activo (opcional).
    pub game_id: Option<String>,
    /// Nombre del juego activo (opcional).
    pub game_name: Option<String>,
}

/// Payload de error del servidor.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ErrorData {
    /// Mensaje explicativo del error.
    pub message: String,
}

/// Datos de señalización para sesión de streaming.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StreamSignalData {
    /// Usuario origen.
    pub from_user_id: String,
    /// Usuario destino (opcional).
    pub target_user_id: Option<String>,
    /// Nombre del evento de señalización WebRTC.
    pub event: String,
    /// Identificador único del stream.
    pub stream_id: String,
    /// Payload libre en JSON (SDP, Candidate, etc.).
    pub payload: Option<Value>,
    /// Timestamp Unix en milisegundos.
    pub timestamp: u64,
}

/// Notificación de sesión LAN pendiente recibida por WS.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TransferSessionPendingData {
    /// Token de autorización de la sesión LAN.
    pub token: String,
    /// Clave del juego asociado al save.
    pub game_key: String,
    /// Hash del manifiesto de guardado.
    pub manifest_hash: String,
    /// Fecha/hora ISO-8601 de expiración de la sesión.
    pub expires_at: String,
}

/// Payload para difusión de presencia enviada desde el cliente al servidor.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloudBroadcastPayload {
    /// Acción ejecutada (ej. "broadcast").
    pub action: String,
    /// ID del usuario emisor.
    pub broadcaster_user_id: String,
    /// ID del juego iniciado o cadena vacía si se cerró.
    pub game_id: String,
    /// Nombre del juego o cadena vacía si se cerró.
    pub game_name: String,
}

/// Payload para envío de señales de streaming WebRTC.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloudStreamSignalPayload {
    /// Acción ejecutada (ej. "stream_signal").
    pub action: String,
    /// Tipo de mensaje.
    #[serde(rename = "type")]
    pub message_type: String,
    /// Evento de señalización WebRTC.
    pub event: String,
    /// ID de la sesión de streaming.
    pub stream_id: String,
    /// Usuario objetivo de la señal.
    pub target_user_id: Option<String>,
    /// Payload arbitrario asociado.
    pub payload: Option<Value>,
}

/// Mensaje saliente desde Rust hacia la conexión WebSocket.
#[derive(Debug, Clone)]
pub enum CloudOutgoingMessage {
    /// Mensaje de difusión de presencia.
    Broadcast(CloudBroadcastPayload),
    /// Mensaje de señalización de streaming.
    StreamSignal(CloudStreamSignalPayload),
}

/// Métricas de tiempo de ejecución del cliente WebSocket para el panel de salud y observabilidad.
#[derive(Clone, Default, Debug)]
pub struct WsRuntimeMetrics {
    /// Indica si el WebSocket está conectado actualmente.
    pub connected: bool,
    /// Timestamp Unix en ms de la última conexión exitosa.
    pub last_connected_at_ms: Option<i64>,
    /// Timestamp Unix en ms de la última desconexión.
    pub last_disconnected_at_ms: Option<i64>,
    /// Descripción del último error registrado.
    pub last_error: Option<String>,
    /// Timestamp Unix en ms del último error.
    pub last_error_at_ms: Option<i64>,
    /// Contador total acumulado de conexiones establecidas exitosamente.
    pub total_successful_connections: u64,
}

use rand::Rng;

/// Aplica un Jitter aleatorio (±20%) a la duración del backoff para evitar colisiones de reconexión.
fn apply_backoff_jitter(backoff: Duration) -> Duration {
    let mut rng = rand::thread_rng();
    let jitter_factor: f64 = rng.gen_range(0.8..=1.2);
    let millis = (backoff.as_millis() as f64 * jitter_factor).max(100.0);
    Duration::from_millis(millis as u64)
}

/// Devuelve el timestamp Unix actual en milisegundos en UTC.
fn utc_now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Inicia el bucle principal del cliente WebSocket en un hilo de fondo.
///
/// Gestiona las reconexiones automáticas, el envío periódico de tramas *Ping* de Keep-Alive,
/// la detección de suspensión del sistema (Sleep/Resume), el parsing de payloads entrantes
/// y el despacho de mensajes salientes.
///
/// # Argumentos
///
/// * `app_handle` - Handle de la aplicación Tauri para emitir eventos IPC hacia la UI.
/// * `url_str` - URL completa del endpoint WebSocket.
/// * `rx` - Canal mpsc para recibir mensajes a enviar desde la aplicación.
/// * `logs` - Almacén de logs en memoria para observabilidad local.
/// * `ready_notify` - Sender one-shot para notificar cuando la primera conexión esté lista.
/// * `metrics` - Contenedor mutante thread-safe de métricas de runtime.
pub async fn start_ws_loop(
    app_handle: AppHandle,
    url_str: String,
    mut rx: mpsc::UnboundedReceiver<CloudOutgoingMessage>,
    logs: AppLogs,
    mut ready_notify: Option<oneshot::Sender<()>>,
    metrics: Option<Arc<Mutex<WsRuntimeMetrics>>>,
) {
    if let Err(e) = Url::parse(&url_str) {
        log_cloud(&app_handle, &logs, "error", &format!("URL inválida: {}", e)).await;
        if let Some(ref m) = metrics {
            let mut g = m.lock().await;
            g.connected = false;
            g.last_error = Some(format!("URL inválida: {}", e));
            g.last_error_at_ms = Some(utc_now_ms());
        }
        return;
    }

    let mut backoff = Duration::from_secs(INITIAL_BACKOFF_SECS);
    let mut last_friend_game: HashMap<String, String> = HashMap::new();

    loop {
        match connect_async(url_str.as_str()).await {
            Ok((ws_stream, _)) => {
                backoff = Duration::from_secs(INITIAL_BACKOFF_SECS);
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

                if let Some(tx) = ready_notify.take() {
                    let _ = tx.send(());
                }

                let (mut ws_sender, mut ws_receiver) = ws_stream.split();

                let mut ping_interval =
                    tokio::time::interval(Duration::from_secs(PING_INTERVAL_SECS));
                ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
                ping_interval.tick().await;

                let mut last_tick_instant = tokio::time::Instant::now();

                loop {
                    tokio::select! {
                        _ = ping_interval.tick() => {
                            let now = tokio::time::Instant::now();
                            let elapsed = now.duration_since(last_tick_instant);
                            last_tick_instant = now;

                            // Detección de suspensión del sistema (Sleep/Resume PC):
                            // Si el tiempo transcurrido entre ticks supera significativamente el intervalo (ej. > 40s),
                            // el sistema estuvo suspendido. Se fuerza un reinicio limpio del socket.
                            if elapsed > Duration::from_secs(PING_INTERVAL_SECS + 15) {
                                log_cloud(
                                    &app_handle,
                                    &logs,
                                    "warn",
                                    "Detección de suspensión/reanudación del sistema (Sleep/Resume). Reiniciando socket...",
                                )
                                .await;
                                record_disconnect_metric(&metrics).await;
                                break;
                            }

                            if let Err(e) = ws_sender.send(Message::Ping(Vec::new().into())).await {
                                log_cloud(
                                    &app_handle,
                                    &logs,
                                    "warn",
                                    &format!("Ping de mantenimiento falló: {}. Reconectando...", e),
                                )
                                .await;
                                record_error_metric(&metrics, &format!("ping: {}", e)).await;
                                break;
                            }
                        }

                        Some(msg) = ws_receiver.next() => {
                            match msg {
                                Ok(Message::Ping(payload)) => {
                                    let _ = ws_sender.send(Message::Pong(payload)).await;
                                }
                                Ok(Message::Pong(_)) => {
                                    // Servidor confirmó recepción del Ping.
                                }
                                Ok(Message::Text(text)) => {
                                    handle_incoming_text(
                                        &app_handle,
                                        &logs,
                                        &mut last_friend_game,
                                        &text,
                                    )
                                    .await;
                                }
                                Ok(Message::Close(_)) => {
                                    log_cloud(
                                        &app_handle,
                                        &logs,
                                        "info",
                                        "Conexión cerrada por el servidor.",
                                    )
                                    .await;
                                    record_disconnect_metric(&metrics).await;
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
                                    record_error_metric(&metrics, &format!("recv: {}", e)).await;
                                    break;
                                }
                                _ => {}
                            }
                        }

                        Some(outgoing) = rx.recv() => {
                            send_outgoing_message(&mut ws_sender, &app_handle, &logs, outgoing).await;
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
                record_error_metric(&metrics, &format!("connect: {}", e)).await;
            }
        }

        let sleep_duration = apply_backoff_jitter(backoff);
        tokio::time::sleep(sleep_duration).await;
        backoff = std::cmp::min(backoff * 2, Duration::from_secs(MAX_BACKOFF_SECS));
    }
}

/// Procesa un mensaje de texto entrante por la conexión WebSocket.
async fn handle_incoming_text(
    app_handle: &AppHandle,
    logs: &AppLogs,
    last_friend_game: &mut HashMap<String, String>,
    text: &str,
) {
    let text_preview: String = text.chars().take(220).collect();
    sync_logger::log_operation(
        "cloud_ws_text_received",
        &format!("payloadPreview={}", text_preview),
    );

    match serde_json::from_str::<CloudIncomingMessage>(text) {
        Ok(incoming) => {
            process_incoming_payload(app_handle, logs, last_friend_game, &incoming).await;

            let msg_kind = match &incoming {
                CloudIncomingMessage::FriendPlaying { .. } => "FRIEND_PLAYING",
                CloudIncomingMessage::PresenceUpdate { .. } => "PRESENCE_UPDATE",
                CloudIncomingMessage::Error { .. } => "ERROR",
                CloudIncomingMessage::StreamSignal { .. } => "STREAM_SIGNAL",
                CloudIncomingMessage::TransferSessionPending { .. } => "TRANSFER_SESSION_PENDING",
            };

            sync_logger::log_operation("cloud_ws_message_parsed", &format!("kind={}", msg_kind));

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

/// Aplica la lógica de negocio secundaria para mensajes entrantes (notificaciones overlay, registro LAN, etc.).
async fn process_incoming_payload(
    app_handle: &AppHandle,
    logs: &AppLogs,
    last_friend_game: &mut HashMap<String, String>,
    incoming: &CloudIncomingMessage,
) {
    match incoming {
        CloudIncomingMessage::FriendPlaying { data } => {
            log_cloud(
                app_handle,
                logs,
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
                    data.friend_user_id, data.game_id, data.game_name
                ),
            );

            let already_notified = last_friend_game
                .get(&data.friend_user_id)
                .map(|prev_id| prev_id == &data.game_id)
                .unwrap_or(false);

            if !already_notified && !data.game_id.is_empty() {
                last_friend_game.insert(data.friend_user_id.clone(), data.game_id.clone());

                if let Err(e) = crate::overlay::show_overlay_notification(
                    app_handle.clone(),
                    "Amigo jugando".to_string(),
                    Some(format!("{} está jugando {}", data.friend_user_id, data.game_name)),
                )
                .await
                {
                    sync_logger::log_error(
                        "overlay_notification_from_ws_failed",
                        &format!(
                            "friendUserId={} gameId={} gameName={}",
                            data.friend_user_id, data.game_id, data.game_name
                        ),
                        &e,
                    );
                }
            } else if data.game_id.is_empty() {
                last_friend_game.remove(&data.friend_user_id);
            }
        }
        CloudIncomingMessage::TransferSessionPending { data } => {
            log_cloud(
                app_handle,
                logs,
                "info",
                &format!(
                    "Nueva sesión de transferencia LAN pendiente recibida por WebSocket: {}",
                    data.game_key
                ),
            )
            .await;

            let token = data.token.clone();
            let game_key = data.game_key.clone();
            let manifest_hash = data.manifest_hash.clone();
            let expires_at = data.expires_at.clone();

            tauri::async_runtime::spawn(async move {
                if let Err(e) = crate::peer_lan::poller::register_and_serve_session(
                    token,
                    game_key,
                    manifest_hash,
                    expires_at,
                )
                .await
                {
                    sync_logger::log_error("ws_register_and_serve_session_failed", &e, &e);
                }
            });
        }
        _ => {}
    }
}

/// Envía un mensaje saliente a través del sink WebSocket.
async fn send_outgoing_message(
    ws_sender: &mut WsSender,
    app_handle: &AppHandle,
    logs: &AppLogs,
    outgoing: CloudOutgoingMessage,
) {
    let serialized = match outgoing {
        CloudOutgoingMessage::Broadcast(ref payload) => serde_json::to_string(payload),
        CloudOutgoingMessage::StreamSignal(ref payload) => serde_json::to_string(payload),
    };

    if let Ok(text) = serialized {
        if let Err(e) = ws_sender.send(Message::Text(text.into())).await {
            log_cloud(
                app_handle,
                logs,
                "error",
                &format!("Error enviando broadcast: {}", e),
            )
            .await;
        }
    }
}

/// Registra un estado de error en el contenedor global de métricas de observabilidad.
async fn record_error_metric(metrics: &Option<Arc<Mutex<WsRuntimeMetrics>>>, err_msg: &str) {
    if let Some(ref m) = metrics {
        let mut g = m.lock().await;
        g.connected = false;
        g.last_error = Some(err_msg.to_string());
        g.last_error_at_ms = Some(utc_now_ms());
    }
}

/// Registra un evento de desconexión limpia en el contenedor de métricas de observabilidad.
async fn record_disconnect_metric(metrics: &Option<Arc<Mutex<WsRuntimeMetrics>>>) {
    if let Some(ref m) = metrics {
        let mut g = m.lock().await;
        g.connected = false;
        g.last_disconnected_at_ms = Some(utc_now_ms());
    }
}

/// Escribe una entrada en el búfer de logs en memoria y emite el evento correspondiente a la interfaz UI.
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
