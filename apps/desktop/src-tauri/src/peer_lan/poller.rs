//! Poll de sesiones de transferencia pendientes (lado emisor).

use std::time::Duration;

use crate::commands::sync::context::resolve_api_context;
use crate::config::load_settings;
use crate::network::API_CLIENT;
use crate::peer_inventory::resolve_device_id;
use crate::peer_lan::server::{start_lan_server_for_session, stop_lan_server};
use crate::peer_lan::session::{
    register_transfer_session, session_ttl_from_iso, PendingTransferSession,
};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingSessionsResponse {
    items: Vec<PendingSessionDto>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingSessionDto {
    token: String,
    #[serde(rename = "requesterUserId")]
    _requester_user_id: String,
    game_key: String,
    manifest_hash: String,
    expires_at: String,
}

pub async fn poll_and_serve_pending_sessions() -> Result<u32, String> {
    let settings = load_settings();
    if !settings.share_game_inventory_with_cloud {
        return Ok(0);
    }

    let device_id = resolve_device_id()?;
    let ctx = resolve_api_context()?;

    let url = format!(
        "{}/inventory/transfer-sessions/pending?deviceId={}",
        ctx.base_url,
        urlencoding::encode(&device_id)
    );

    let res = API_CLIENT
        .get(&url)
        .header("x-api-key", &ctx.api_key)
        .header("x-user-id", &ctx.user_id)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Ok(0);
    }

    let body: PendingSessionsResponse = res.json().await.map_err(|e| e.to_string())?;

    if body.items.is_empty() {
        stop_lan_server().await;
        return Ok(0);
    }

    let mut served = 0_u32;

    for item in body.items {
        let ttl = session_ttl_from_iso(&item.expires_at);
        register_transfer_session(PendingTransferSession {
            token: item.token.clone(),
            game_key: item.game_key.clone(),
            manifest_hash: item.manifest_hash.clone(),
            expires_at: std::time::Instant::now() + ttl,
        });

        if start_lan_server_for_session(&item.token, &item.game_key)
            .await
            .is_ok()
        {
            served += 1;
        }
    }

    Ok(served)
}

pub fn spawn_pending_session_poller() {
    tauri::async_runtime::spawn(async {
        loop {
            let _ = poll_and_serve_pending_sessions().await;
            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    });
}
