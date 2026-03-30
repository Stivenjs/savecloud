//! Cliente HTTP hacia `/notifications` (misma base URL y cabeceras que `/saves`).

use crate::network::API_CLIENT;

use super::models::{NotificationAckBody, NotificationBatchBody, NotificationListResponse, NotificationRecordDto};

fn api_context() -> Result<(String, String, String), String> {
    let cfg = crate::config::load_config();
    let base_url = cfg
        .api_base_url
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura apiBaseUrl en Configuración")?
        .to_string();
    let user_id = cfg
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura userId en Configuración")?
        .to_string();
    let api_key = cfg.api_key.unwrap_or_default();
    Ok((base_url, user_id, api_key))
}

fn notifications_url(base: &str, path: &str) -> String {
    format!(
        "{}/notifications{}",
        base.trim_end_matches('/'),
        path
    )
}

pub async fn push_batch(items: Vec<NotificationRecordDto>) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let (base_url, user_id, api_key) = api_context()?;
    let url = notifications_url(&base_url, "/batch");
    let body = NotificationBatchBody { items };
    let res = API_CLIENT
        .post(&url)
        .header("x-user-id", user_id)
        .header("x-api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("notifications batch: {}", txt));
    }
    Ok(())
}

pub async fn pull_since(cursor: Option<&str>, limit: i64) -> Result<NotificationListResponse, String> {
    let (base_url, user_id, api_key) = api_context()?;
    let mut url = notifications_url(&base_url, "");
    let mut q = format!("?limit={limit}");
    if let Some(c) = cursor.filter(|s| !s.trim().is_empty()) {
        q.push_str(&format!("&cursor={}", urlencoding::encode(c)));
    }
    url.push_str(&q);

    let res = API_CLIENT
        .get(&url)
        .header("x-user-id", user_id)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("notifications pull: {}", txt));
    }
    res.json::<NotificationListResponse>()
        .await
        .map_err(|e| e.to_string())
}

pub async fn ack_remote(ids: Vec<String>, read: bool, dismiss: bool) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let (base_url, user_id, api_key) = api_context()?;
    let url = notifications_url(&base_url, "/ack");
    let body = NotificationAckBody {
        ids,
        read: Some(read),
        dismiss: Some(dismiss),
    };
    let res = API_CLIENT
        .post(&url)
        .header("x-user-id", user_id)
        .header("x-api-key", api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        let txt = res.text().await.unwrap_or_default();
        return Err(format!("notifications ack: {}", txt));
    }
    Ok(())
}
