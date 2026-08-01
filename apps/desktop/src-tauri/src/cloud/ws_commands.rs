//! Comandos IPC de Tauri para la gestión del servicio WebSocket de SaveCloud.
//!
//! Este módulo expone las funciones anotadas con `#[tauri::command]` consumidas
//! por la interfaz de usuario en React para conectar, desconectar y transmitir eventos
//! de presencia y streaming en tiempo real.

use super::ws_client::{CloudBroadcastPayload, CloudStreamSignalPayload};
use super::ws_manager::CloudWsState;
use crate::commands::logs::sync_logger;
use crate::config;
use crate::plugins::log_buffer::AppLogs;
use serde_json::Value;
use tauri::{command, AppHandle, State};

/// Adjunta parámetros de consulta URL (query string) a una URL base de WebSocket de forma segura.
///
/// Garantiza la preservación del esquema, host, puerto y ruta válida (mínimo `/`).
fn append_ws_query(ws_base: &str, query: &str) -> String {
    let trimmed = ws_base.trim();
    if let Ok(parsed) = url::Url::parse(trimmed) {
        let scheme = parsed.scheme();
        let host = parsed.host_str().unwrap_or("");
        let port_part = match parsed.port() {
            Some(p) => format!(":{}", p),
            None => String::new(),
        };
        let path = parsed.path();
        let effective_path = if path.is_empty() { "/" } else { path };
        format!(
            "{}://{}{}{}?{}",
            scheme, host, port_part, effective_path, query
        )
    } else {
        format!("{}/?{}", trimmed.trim_end_matches('/'), query)
    }
}

/// Inicia la conexión WebSocket remota con la nube de SaveCloud.
///
/// Resuelve la autenticación y parámetros según el modo de operación (Host propio o Invitado/Guest),
/// construye la URL autenticada y delega la ejecución al [`CloudWsState`].
///
/// # Argumentos
/// * `app_handle` - Handle de la aplicación Tauri.
/// * `cloud_state` - Estado global inyectado del administrador de WebSocket.
/// * `logs` - Búfer de registros de observabilidad inyectado.
///
/// # Errores
/// Retorna un `Err(String)` si falta la configuración de usuario, token, API Key o credenciales.
#[command]
pub async fn start_cloud_ws(
    app_handle: AppHandle,
    cloud_state: State<'_, CloudWsState>,
    logs: State<'_, AppLogs>,
) -> Result<(), String> {
    let settings = config::load_settings();

    let user_id = settings
        .user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or("userID no configurado")?
        .to_string();

    let active_host = settings
        .active_cloud_host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let device_id = crate::peer_inventory::resolve_device_id()?;

    let final_url = if let Some(ref host) = active_host {
        let ws_base_raw = settings
            .cloud_host_ws_base_urls
            .get(host)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                settings
                    .cloud_host_api_base_urls
                    .get(host)
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
            })
            .ok_or("No hay URL de nube para este host.")?;
        let ws_base = crate::commands::share::invites::normalize_ws_url(ws_base_raw);

        let token = config::get_secure_api_key_for_cloud_host(host)
            .ok_or("No tienes credenciales (token) para este host.")?;

        let query = format!(
            "userId={}&token={}&deviceId={}",
            urlencoding::encode(&user_id),
            urlencoding::encode(&token),
            urlencoding::encode(&device_id)
        );
        append_ws_query(&ws_base, &query)
    } else {
        let ws_base_raw = settings
            .ws_base_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| {
                settings
                    .api_base_url
                    .as_deref()
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
            })
            .ok_or("URL de nube no configurada en ajustes.")?;
        let ws_base = crate::commands::share::invites::normalize_ws_url(ws_base_raw);

        let api_key = settings
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("API Key no configurada en ajustes.")?;

        let query = format!(
            "userId={}&apiKey={}&deviceId={}",
            urlencoding::encode(&user_id),
            urlencoding::encode(api_key),
            urlencoding::encode(&device_id)
        );
        append_ws_query(&ws_base, &query)
    };

    let ws_endpoint_preview = final_url
        .split('?')
        .next()
        .unwrap_or("unknown");

    let mode = if active_host.is_some() { "guest" } else { "host" };

    sync_logger::log_operation(
        "cloud_ws_start",
        &format!(
            "mode={} userId={} endpoint={}",
            mode, user_id, ws_endpoint_preview
        ),
    );

    cloud_state
        .start(app_handle, final_url, logs.inner().clone())
        .await;

    Ok(())
}

/// Detiene manualmente la conexión activa con el servidor WebSocket.
///
/// # Argumentos
/// * `cloud_state` - Estado global inyectado del administrador de WebSocket.
#[command]
pub async fn stop_cloud_ws(cloud_state: State<'_, CloudWsState>) -> Result<(), String> {
    cloud_state.stop().await;
    Ok(())
}

/// Transmite una actualización de difusión de juego (presencia) hacia la nube.
///
/// Si la conexión aún no ha completado el arranque en frío, el mensaje se guarda en la cola
/// temporal y se transmitirá automáticamente al conectar.
///
/// # Argumentos
/// * `game_id` - ID único del juego activo (o cadena vacía si se cerró).
/// * `game_name` - Nombre descriptivo del juego (o cadena vacía si se cerró).
/// * `cloud_state` - Estado global inyectado del administrador de WebSocket.
#[command]
pub async fn send_cloud_broadcast(
    game_id: String,
    game_name: String,
    cloud_state: State<'_, CloudWsState>,
) -> Result<(), String> {
    let settings = config::load_settings();

    let user_id = settings
        .user_id
        .ok_or("UserID no disponible para realizar el broadcast.")?;

    let payload = CloudBroadcastPayload {
        action: "broadcast".to_string(),
        broadcaster_user_id: user_id,
        game_id,
        game_name,
    };

    cloud_state.send_broadcast(payload).await
}

/// Envía una señal de control de streaming WebRTC entre pares a través del WebSocket.
///
/// # Argumentos
/// * `event` - Nombre del evento de transmisión (ej. "offer", "answer", "candidate").
/// * `stream_id` - ID único de la sesión de streaming.
/// * `target_user_id` - ID del usuario destino de la señal (opcional).
/// * `payload` - Datos arbitrarios en formato JSON (opcional).
/// * `cloud_state` - Estado global inyectado del administrador de WebSocket.
#[command]
pub async fn send_cloud_stream_signal(
    event: String,
    stream_id: String,
    target_user_id: Option<String>,
    payload: Option<Value>,
    cloud_state: State<'_, CloudWsState>,
) -> Result<(), String> {
    let signal = CloudStreamSignalPayload {
        action: "broadcast".to_string(),
        message_type: "STREAM_SIGNAL".to_string(),
        event,
        stream_id,
        target_user_id,
        payload,
    };

    cloud_state.send_stream_signal(signal).await
}
