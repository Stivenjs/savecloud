//! Cliente HTTP hacia `/notifications` (misma base URL y cabeceras que `/saves`).
//!
//! Usa [`crate::commands::sync::context::resolve_api_context`] para que miembros de nube compartida
//! apunten a la API del anfitrión y al token guardado al aceptar la invitación (no solo `settings.api_key`).

use crate::cloud::api_error;
use crate::network::API_CLIENT;

use super::models::{
    NotificationAckBody, NotificationBatchBody, NotificationListResponse, NotificationRecordDto,
};

fn attach_cloud_host_header(mut req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    if let Some(host) = crate::config::load_settings()
        .active_cloud_host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        req = req.header("x-cloud-host-user-id", host);
    }
    req
}

fn notifications_url(base: &str, path: &str) -> String {
    format!("{}/notifications{}", base.trim_end_matches('/'), path)
}

pub async fn push_batch(items: Vec<NotificationRecordDto>) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    let ctx = crate::commands::sync::context::resolve_api_context()?;
    let url = notifications_url(&ctx.base_url, "/batch");
    let body = NotificationBatchBody { items };
    let res = attach_cloud_host_header(
        API_CLIENT
            .post(&url)
            .header("x-user-id", &ctx.user_id)
            .header("x-api-key", &ctx.api_key),
    )
    .json(&body)
    .send()
    .await
    .map_err(|_| api_error::network_message())?;
    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

pub async fn pull_since(
    cursor: Option<&str>,
    limit: i64,
) -> Result<NotificationListResponse, String> {
    let ctx = crate::commands::sync::context::resolve_api_context()?;
    let mut url = notifications_url(&ctx.base_url, "");
    let mut q = format!("?limit={limit}");
    if let Some(c) = cursor.filter(|s| !s.trim().is_empty()) {
        q.push_str(&format!("&cursor={}", urlencoding::encode(c)));
    }
    url.push_str(&q);

    let res = attach_cloud_host_header(
        API_CLIENT
            .get(&url)
            .header("x-user-id", &ctx.user_id)
            .header("x-api-key", &ctx.api_key),
    )
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

pub async fn ack_remote(ids: Vec<String>, read: bool, dismiss: bool) -> Result<(), String> {
    if ids.is_empty() {
        return Ok(());
    }
    let ctx = crate::commands::sync::context::resolve_api_context()?;
    let url = notifications_url(&ctx.base_url, "/ack");
    let body = NotificationAckBody {
        ids,
        read: Some(read),
        dismiss: Some(dismiss),
    };
    let res = attach_cloud_host_header(
        API_CLIENT
            .post(&url)
            .header("x-user-id", &ctx.user_id)
            .header("x-api-key", &ctx.api_key),
    )
    .json(&body)
    .send()
    .await
    .map_err(|_| api_error::network_message())?;
    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}
