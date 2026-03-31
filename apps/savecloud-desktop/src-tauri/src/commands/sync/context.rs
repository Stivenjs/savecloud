//! Resolución centralizada del contexto de API para sync/cloud.
//!
//! Prioridad:
//! 1) Si hay host activo de nube compartida, usa su base URL + token seguro por host.
//! 2) Si no, usa la configuración de nube propia (api_base_url + api_key).

#[derive(Clone, Debug)]
pub(crate) struct ApiContext {
    pub(crate) base_url: String,
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
        if let Some(host_base_url) = settings.cloud_host_api_base_urls.get(active_host) {
            let host_api_key = crate::config::get_secure_api_key_for_cloud_host(active_host)
                .ok_or("Faltan credenciales de acceso para este host")?;
            return Ok(ApiContext {
                base_url: host_base_url.trim_end_matches('/').to_string(),
                user_id,
                api_key: host_api_key,
            });
        }
    }

    let base_url = settings
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura URL de la API en Configuración")?
        .to_string();

    let api_key = settings
        .api_key
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu clave de acceso (apiKey)")?
        .to_string();

    Ok(ApiContext {
        base_url,
        user_id,
        api_key,
    })
}
