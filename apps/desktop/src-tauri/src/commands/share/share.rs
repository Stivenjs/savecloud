//! Gestión de recursos compartidos de SaveCloud.
//!
//! Este módulo implementa la lógica de comunicación con la API de SaveCloud para
//! la creación y resolución de enlaces de compartición de partidas guardadas,
//! canalizada mediante el cliente unificado de nube.

use crate::cloud::api_error::ensure_success;
use crate::cloud::cloud_api;
use crate::errors::{AppError, AppResult};
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

/// Información de un archivo dentro del recurso compartido.
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ShareFileInfo {
    pub filename: String,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub key: Option<String>,
}

/// Información recuperada al resolver un token de compartición.
#[derive(Debug, Deserialize, Serialize)]
pub struct ResolvedShare {
    /// Identificador del usuario propietario del recurso.
    #[serde(rename = "userId")]
    pub user_id: String,
    /// Identificador del juego asociado.
    #[serde(rename = "gameId")]
    pub game_id: String,
    /// Fecha de expiración en formato ISO.
    #[serde(rename = "expiresAt", default)]
    pub expires_at: Option<String>,
    /// Lista de archivos asociados al juego compartido.
    #[serde(default)]
    pub files: Option<Vec<ShareFileInfo>>,
    /// Indica si el juego fue respaldado en formato empaquetado (.tar).
    #[serde(rename = "isPackaged", default)]
    pub is_packaged: Option<bool>,
}

/// Crea un enlace de compartición remoto invocando la API de SaveCloud.
///
/// # Arguments
///
/// * `game_id` - Identificador único del juego a compartir.
/// * `expires_in_days` - Días de validez para el enlace (por defecto 7).
///
/// # Returns
///
/// URL pública del recurso compartido.
///
/// # Errors
///
/// Devuelve [`AppError`] si falla la serialización, la red o el servidor responde con error.
#[command]
pub async fn create_remote_share_link(
    game_id: String,
    expires_in_days: Option<u32>,
) -> AppResult<String> {
    let payload = ShareRequest {
        game_id,
        expires_in_days: expires_in_days.unwrap_or(7),
    };

    let response = cloud_api(reqwest::Method::POST, "/share")
        .json(&payload)
        .map_err(|e| AppError::new("SERIALIZATION_ERROR", e))?
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;

    let data = ensure_success(response)
        .await?
        .json::<ShareResponse>()
        .await
        .map_err(|_| {
            AppError::new(
                "INVALID_RESPONSE",
                "El servidor devolvió una respuesta inválida.",
            )
        })?;

    Ok(data.share_url)
}

/// Resuelve un token de compartición para obtener los metadatos del recurso.
///
/// # Arguments
///
/// * `token` - Código único del enlace compartido.
///
/// # Returns
///
/// Estructura [`ResolvedShare`] con los metadatos del recurso.
///
/// # Errors
///
/// Devuelve [`AppError`] si la petición falla o la respuesta no es válida.
#[command]
pub async fn resolve_remote_share_token(token: String) -> AppResult<ResolvedShare> {
    let path = format!("/share/{}", token.trim());
    let response = cloud_api(reqwest::Method::GET, &path)
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;

    ensure_success(response)
        .await?
        .json::<ResolvedShare>()
        .await
        .map_err(|_| {
            AppError::new(
                "INVALID_RESPONSE",
                "El servidor devolvió una respuesta inválida.",
            )
        })
}
