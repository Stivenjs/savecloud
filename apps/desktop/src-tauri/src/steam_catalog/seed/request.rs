use crate::cloud::client::cloud_api;

pub(crate) async fn seed_api_request(
    method: reqwest::Method,
    path: &str,
    body: Option<&[u8]>,
) -> Result<reqwest::Response, String> {
    let path = format!("/saves/{}", path.trim_start_matches('/'));
    cloud_api(method, &path).body_opt(body).send().await
}

pub(crate) fn validate_presigned_url(url: &str) -> Result<(), String> {
    let parsed =
        url::Url::parse(url.trim()).map_err(|error| format!("URL prefirmada inválida: {error}"))?;

    if !matches!(parsed.scheme(), "https" | "http") {
        return Err("La URL prefirmada usa un esquema no permitido.".to_string());
    }
    if parsed.host_str().is_none() {
        return Err("La URL prefirmada no contiene un host válido.".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("La URL prefirmada no puede contener credenciales embebidas.".to_string());
    }
    if parsed.fragment().is_some() {
        return Err("La URL prefirmada no puede contener un fragmento.".to_string());
    }

    Ok(())
}
