//! Datanodes: POST multipart para obtener URL directa.

use serde::Deserialize;

use crate::network::{post_multipart, ProfilePreset};

use super::error::{ensure_resolve, HosterError};

#[derive(Deserialize)]
struct DatanodesJson {
    url: Option<String>,
}

pub async fn resolve(client: &reqwest::Client, url: &str) -> Result<String, HosterError> {
    let parsed = reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let path_segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    let file_code = path_segments
        .first()
        .ok_or_else(|| HosterError::ResolutionFailed("datanodes: sin código en ruta".into()))?;

    let form = reqwest::multipart::Form::new()
        .text("op", "download2")
        .text("id", file_code.to_string())
        .text("rand", "")
        .text("referer", "https://datanodes.to/download")
        .text("method_free", "Free Download >>")
        .text("method_premium", "")
        .text("__dl", "1")
        .text("g_captch__a", "1");

    let response = post_multipart(
        client,
        "https://datanodes.to/download",
        ProfilePreset::DatanodesResolve,
        form,
    )
    .await?;

    let response = ensure_resolve(response)?;
    let parsed_json: DatanodesJson = response.json().await?;
    let u = parsed_json
        .url
        .ok_or_else(|| HosterError::ResolutionFailed("datanodes: respuesta sin url".into()))?;
    Ok(urlencoding::decode(&u).map(|c| c.into_owned()).unwrap_or(u))
}
