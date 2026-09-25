//! Resolución centralizada del contexto de API para sync/cloud.
//!
//! Prioridad:
//! 1) Si hay host activo de nube compartida, usa su base URL + token seguro por host.
//! 2) Si no, usa la configuración de nube propia (api_base_url + api_key).

#[derive(Clone)]
pub(crate) struct ApiContext {
    pub(crate) base_url: String,
    #[allow(dead_code)]
    pub(crate) ws_base_url: Option<String>,
    pub(crate) user_id: String,
    pub(crate) api_key: String,
}

pub(crate) fn resolve_api_context() -> Result<ApiContext, String> {
    let settings = crate::config::load_settings();

    let user_id = settings
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu usuario en Configuración")?
        .to_string();

    if let Some(active_host) = settings
        .active_cloud_host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let host_base_url = settings
            .cloud_host_api_base_urls
            .get(active_host)
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or(
                "La nube compartida activa no tiene URL configurada. Reacepta la invitación o cambia a tu nube.",
            )?;
        let host_api_key = crate::config::get_secure_api_key_for_cloud_host(active_host).ok_or(
            "La nube compartida activa no tiene credenciales guardadas. Reacepta la invitación.",
        )?;
        let host_ws_base_url = settings
            .cloud_host_ws_base_urls
            .get(active_host)
            .cloned();
        return Ok(ApiContext {
            base_url: crate::commands::share::invites::normalize_base_url(host_base_url),
            ws_base_url: host_ws_base_url.map(|u| crate::commands::share::invites::normalize_ws_url(&u)),
            user_id,
            api_key: host_api_key,
        });
    }

    let ws_base_url = settings
        .ws_base_url
        .clone()
        .filter(|s| !s.trim().is_empty())
        .map(|u| crate::commands::share::invites::normalize_ws_url(&u));

    let base_url_raw = settings
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura URL de la API en Configuración")?;
    let base_url = crate::commands::share::invites::normalize_base_url(base_url_raw);

    let api_key = settings
        .api_key
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu clave de acceso (apiKey)")?
        .to_string();

    Ok(ApiContext {
        base_url,
        ws_base_url,
        user_id,
        api_key,
    })
}
