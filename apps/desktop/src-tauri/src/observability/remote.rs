//! Obtiene el resumen de observabilidad desde la API HTTP (credenciales en Rust).

use serde_json::Value;
use tauri::command;

use crate::commands::sync::context::resolve_api_context;
use crate::network::API_CLIENT;

/// `None` si no hay contexto de API válido o la petición falla (el panel sigue mostrando datos locales).
#[command]
pub async fn get_remote_observability_summary(window: Option<String>) -> Result<Option<Value>, String> {
    let ctx = match resolve_api_context() {
        Ok(c) => c,
        Err(_) => return Ok(None),
    };

    let w = window
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("15m")
        .to_string();

    let url = format!(
        "{}/observability/desktop/summary?window={}",
        ctx.base_url.trim_end_matches('/'),
        urlencoding::encode(&w)
    );

    let response = {
        let mut req = API_CLIENT
            .get(&url)
            .header("x-user-id", &ctx.user_id)
            .header("x-api-key", &ctx.api_key);
        if let Some(host) = crate::config::load_settings()
            .active_cloud_host_user_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            req = req.header("x-cloud-host-user-id", host);
        }
        req.send().await
    }
    .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let body: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(Some(body))
}
