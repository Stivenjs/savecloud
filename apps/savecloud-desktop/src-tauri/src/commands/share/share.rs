//! Gestión de recursos compartidos de SaveCloud.
//!
//! Este módulo implementa la lógica de comunicación con la API de AWS para
//! la creación y resolución de enlaces de compartición de partidas guardadas.
//! Utiliza el estado gestionado de Tauri para mantener un pool de conexiones
//! HTTP persistente, reduciendo la latencia en las negociaciones TLS.

use crate::network::API_CLIENT;
use serde::{Deserialize, Serialize};
use tauri::command;

/// Estructura de datos para la solicitud de creación de un enlace compartido.
#[derive(Debug, Serialize)]
struct ShareRequest {
    /// Identificador único del juego (ej. "cyberpunk-2077").
    #[serde(rename = "gameId")]
    game_id: String,
    /// Tiempo de validez del enlace en días.
    #[serde(rename = "expiresInDays")]
    expires_in_days: u32,
}

/// Respuesta exitosa de la API de compartición.
#[derive(Debug, Deserialize)]
#[allow(unused)]
pub struct ShareResponse {
    /// Token único identificador del recurso compartido.
    pub token: String,
    /// URL completa para acceder al recurso.
    #[serde(rename = "shareUrl")]
    pub share_url: String,
}

/// Información básica recuperada al resolver un token de compartición.
#[derive(Debug, Deserialize, Serialize)]
pub struct ResolvedShare {
    /// Identificador del usuario propietario del recurso.
    #[serde(rename = "userId")]
    pub user_id: String,
    /// Identificador del juego asociado.
    #[serde(rename = "gameId")]
    pub game_id: String,
}

/// Crea un enlace de compartición remoto invocando la API de SaveCloud.
///
/// Recupera las credenciales del Keyring local y realiza una petición POST autenticada.
///
/// # Arguments
/// * `game_id` - ID del juego a compartir.
/// * `expires_in_days` - Días de expiración (por defecto 7).
#[command]
pub async fn create_remote_share_link(
    game_id: String,
    expires_in_days: Option<u32>,
) -> Result<String, String> {
    let api_ctx = crate::commands::sync::context::resolve_api_context()?;
    let base_url = api_ctx.base_url;
    let api_key = api_ctx.api_key;
    let user_id = api_ctx.user_id;

    let endpoint = format!("{}/share", base_url.trim_end_matches('/'));

    let payload = ShareRequest {
        game_id,
        expires_in_days: expires_in_days.unwrap_or(7),
    };

    let response = API_CLIENT
        .post(&endpoint)
        .header("x-api-key", api_key)
        .header("x-user-id", user_id)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "API Error ({}): {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    let data = response
        .json::<ShareResponse>()
        .await
        .map_err(|e| format!("Error de deserialización: {}", e))?;

    Ok(data.share_url)
}

/// Resuelve un token de compartición para obtener los metadatos del recurso.
///
/// Esta operación es pública (no requiere x-api-key) según la política de la API.
///
/// # Arguments
/// * `token` - El código único del enlace compartido.
#[command]
pub async fn resolve_remote_share_token(token: String) -> Result<ResolvedShare, String> {
    let api_ctx = crate::commands::sync::context::resolve_api_context()?;
    let base_url = api_ctx.base_url;

    let endpoint = format!("{}/share/{}", base_url.trim_end_matches('/'), token);

    let response = API_CLIENT
        .get(&endpoint)
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Token inválido o expirado ({})", response.status()));
    }

    response
        .json::<ResolvedShare>()
        .await
        .map_err(|e| format!("Error al procesar metadatos del token: {}", e))
}
