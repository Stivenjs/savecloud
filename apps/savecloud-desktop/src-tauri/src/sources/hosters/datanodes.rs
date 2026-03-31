//! Datanodes: sesión con cookies + POST 

use serde::Deserialize;

use crate::network::HOSTER_BROWSER_USER_AGENT;

use super::error::HosterError;

#[derive(Deserialize)]
struct DatanodesJson {
    url: Option<String>,
}

/// Cliente con almacén de cookies para `datanodes.to` (no reutilizar `HOSTER_CLIENT` global).
fn datanodes_client() -> Result<reqwest::Client, HosterError> {
    reqwest::Client::builder()
        .user_agent(HOSTER_BROWSER_USER_AGENT)
        .timeout(std::time::Duration::from_secs(120))
        .connect_timeout(std::time::Duration::from_secs(20))
        .cookie_store(true)
        .tcp_nodelay(true)
        .build()
        .map_err(|e| HosterError::ResolutionFailed(format!("datanodes: cliente: {e}")))
}

pub async fn resolve(url: &str) -> Result<String, HosterError> {
    let parsed =
        reqwest::Url::parse(url).map_err(|_| HosterError::InvalidUrl(url.to_string()))?;
    let path_segments: Vec<&str> = parsed.path().split('/').filter(|s| !s.is_empty()).collect();
    let file_code = path_segments
        .first()
        .ok_or_else(|| HosterError::ResolutionFailed("datanodes: sin código en ruta".into()))?;

    let client = datanodes_client()?;

    let form = reqwest::multipart::Form::new()
        .text("op", "download2")
        .text("id", file_code.to_string())
        .text("rand", "")
        .text("referer", "https://datanodes.to/download")
        .text("method_free", "Free Download >>")
        .text("method_premium", "")
        .text("__dl", "1")
        .text("g_captch__a", "1");

    let response = client
        .post("https://datanodes.to/download")
        .header("accept", "*/*")
        .header("accept-language", "en-US,en;q=0.9")
        .header("priority", "u=1, i")
        .header(
            "sec-ch-ua",
            r#""Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141""#,
        )
        .header("sec-ch-ua-mobile", "?0")
        .header("sec-ch-ua-platform", "\"Windows\"")
        .header("sec-fetch-dest", "empty")
        .header("sec-fetch-mode", "cors")
        .header("sec-fetch-site", "same-origin")
        .header("Referer", "https://datanodes.to/download")
        .header("Cookie", "lang=english")
        .multipart(form)
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(HosterError::Http(response.status().as_u16()));
    }

    let parsed_json: DatanodesJson = response.json().await?;
    let u = parsed_json.url.ok_or_else(|| {
        HosterError::ResolutionFailed("datanodes: respuesta sin url".into())
    })?;
    Ok(urlencoding::decode(&u)
        .map(|c| c.into_owned())
        .unwrap_or(u))
}
