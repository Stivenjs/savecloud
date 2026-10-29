//! Cliente HTTP hacia `/notifications`.
//!
//! Utiliza [`crate::cloud::client::cloud_api`] para garantizar resolución transparente
//! de credenciales, auto-renovación de sesiones de invitado y reintentos con jitter.

use crate::cloud::api_error;
use super::models::{
    NotificationAckBody, NotificationBatchBody, NotificationListResponse, NotificationRecordDto,
};

/// Envía un lote de notificaciones locales para sincronizar con la nube.
///
/// # Arguments
///
/// * `items` - Vector de registros de notificación a subir.
///
/// # Returns
///
/// `Ok(())` si el lote fue recibido y procesado por el servidor; `Err(String)` en caso de fallo.
///
/// # Errors
///
/// Devuelve un error si la solicitud de red falla o si el servidor responde con un código de error.
pub async fn push_batch(items: Vec<NotificationRecordDto>) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let body = NotificationBatchBody { items };
    let res = crate::cloud::client::cloud_api(reqwest::Method::POST, "/notifications/batch")
        .json(&body)?
        .send()
        .await
        .map_err(|_| api_error::network_message())?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

/// Consulta notificaciones remotas a partir de un cursor de paginación opcional.
///
/// # Arguments
///
/// * `cursor` - Cursor opcional para paginar a partir de un punto en el tiempo.
/// * `limit` - Cantidad máxima de registros a retornar por página.
///
/// # Returns
///
/// [`NotificationListResponse`] con los registros remotos y el próximo cursor.
///
/// # Errors
///
/// Devuelve un error si falla la comunicación de red o la deserialización de la respuesta JSON.
pub async fn pull_since(
    cursor: Option<&str>,
    limit: i64,
) -> Result<NotificationListResponse, String> {
    let mut path = format!("/notifications?limit={limit}");
    if let Some(c) = cursor.filter(|s| !s.trim().is_empty()) {
        path.push_str(&format!("&cursor={}", urlencoding::encode(c)));
    }

    let res = crate::cloud::client::cloud_api(reqwest::Method::GET, &path)
        .send()
        .await
        .map_err(|_| api_error::network_message())?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }
    res.json::<NotificationListResponse>()
        .await
        .map_err(|_| api_error::invalid_response_message())
}

/// Confirma la lectura o descarte de un conjunto de notificaciones en el servidor.
///
/// # Arguments
///
/// * `ids` - Lista de identificadores de notificación a actualizar.
/// * `read` - `true` para marcarlas como leídas.
/// * `dismiss` - `true` para marcarlas como descartadas/ocultas.
///
/// # Returns
///
/// `Ok(())` si el servidor aplicó el estado; `Err(String)` en caso de error.
///
/// # Errors
///
/// Devuelve un error si la llamada HTTP es rechazada por el servidor o se interrumpe la conexión.
pub async fn ack_remote(ids: Vec<String>, read: bool, dismiss: bool) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let body = NotificationAckBody {
        ids,
        read: Some(read),
        dismiss: Some(dismiss),
    };
    let res = crate::cloud::client::cloud_api(reqwest::Method::POST, "/notifications/ack")
        .json(&body)?
        .send()
        .await
        .map_err(|_| api_error::network_message())?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}
