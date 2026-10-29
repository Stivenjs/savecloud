//! Obtiene el resumen de observabilidad desde la API HTTP (credenciales en Rust).

use serde_json::Value;
use tauri::command;

use crate::cloud::cloud_api;

/// Obtiene el resumen de observabilidad remota desde la API para la ventana de tiempo indicada.
///
/// # Arguments
///
/// * `window` - Ventana temporal de agregación (por defecto "15m").
///
/// # Returns
///
/// `Ok(Some(Value))` con el JSON de métricas si la solicitud fue exitosa, o `Ok(None)` si no hay contexto o falla.
///
/// # Errors
///
/// Devuelve `Err(String)` si ocurre un fallo irrecuperable al procesar la respuesta.
#[command]
pub async fn get_remote_observability_summary(window: Option<String>) -> Result<Option<Value>, String> {
    let w = window
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("15m");

    let path = format!("/observability/desktop/summary?window={}", urlencoding::encode(w));

    let response = match cloud_api(reqwest::Method::GET, &path).send().await {
        Ok(res) => res,
        Err(_) => return Ok(None),
    };

    if !response.status().is_success() {
        return Ok(None);
    }

    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(Some(body))
}
