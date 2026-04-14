//! Comandos de Tauri para la integración con servicios en la nube de SaveCloud.
//!
//! Este archivo expone las funciones `#[tauri::command]` que el frontend de React
//! invoca para controlar las comunicaciones remotas.

use super::ws_client::CloudBroadcastPayload;
use super::ws_manager::CloudWsState;
use crate::config;
use crate::plugins::log_buffer::AppLogs;
use tauri::{command, AppHandle, State};

/// Inicia la conexión WebSocket segura con la infraestructura de la nube.
///
/// Esta función es agnóstica a si el usuario es host o invitado; resuelve las
/// credenciales necesarias desde el almacén seguro (keyring) y levanta la conexión
/// en segundo plano.
///
/// # Returns
/// * `Ok(())` si el proceso de conexión se inició satisfactoriamente.
/// * `Err(String)` si faltan configuraciones críticas (URL, API Key, UserID).
#[command]
pub async fn start_cloud_ws(
    app_handle: AppHandle,
    cloud_state: State<'_, CloudWsState>,
    logs: State<'_, AppLogs>,
) -> Result<(), String> {
    let settings = config::load_settings();

    // 1. Obtener UserID del usuario local.
    let user_id = settings
        .user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(" userID no configurado")?
        .to_string();

    // 2. Determinar si estamos en modo Invitado u Host propio.
    let active_host = settings
        .active_cloud_host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let final_url = if let Some(host) = active_host {
        let ws_base = settings
            .cloud_host_ws_base_urls
            .get(&host)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .ok_or("No hay URL de nube para este host.")?;

        let token = config::get_secure_api_key_for_cloud_host(&host)
            .ok_or("No tienes credenciales (token) para este host.")?;

        format!(
            "{}?userId={}&token={}",
            ws_base.trim_end_matches('/'),
            urlencoding::encode(&user_id),
            urlencoding::encode(&token)
        )
    } else {
        let ws_base = settings
            .ws_base_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("URL de nube no configurada en ajustes.")?;

        let api_key = settings
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or("API Key no configurada en ajustes.")?;

        format!(
            "{}?userId={}&apiKey={}",
            ws_base.trim_end_matches('/'),
            urlencoding::encode(&user_id),
            urlencoding::encode(&api_key)
        )
    };

    // 3. Delegar el inicio al gestor de estado.
    cloud_state
        .start(app_handle, final_url, logs.inner().clone())
        .await;

    Ok(())
}

/// Detiene manualmente la conexión activa con la nube.
#[command]
pub async fn stop_cloud_ws(cloud_state: State<'_, CloudWsState>) -> Result<(), String> {
    cloud_state.stop().await;
    Ok(())
}

/// Envía una notificación de actividad de juego al servidor cloud.
///
/// Este broadcast permite que otros usuarios vean qué estás jugando
/// en tiempo real mediante notificaciones emergentes (overlay).
///
/// # Arguments
/// * `game_id` - Identificador único del juego (normalmente el slug de Steam).
/// * `game_name` - Nombre legible para mostrar en la notificación.
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
