//! Presencia LAN: anuncia el dispositivo en mDNS mientras comparte inventario.

use std::time::Duration;

use crate::commands::sync::context::resolve_api_context;
use crate::config::load_settings;
use crate::peer_inventory::resolve_device_id;
use crate::peer_lan::mdns_registry::{publish_lan_service, withdraw_lan_service};
use crate::peer_lan::server::{ensure_lan_http_server, shutdown_lan_http_server};

pub async fn ensure_lan_presence() {
    let settings = load_settings();
    if !settings.share_game_inventory_with_cloud {
        shutdown_lan_http_server().await;
        withdraw_lan_service();
        return;
    }

    let Ok(device_id) = resolve_device_id() else {
        log::warn!("Presencia LAN: sin deviceId");
        return;
    };
    let Ok(ctx) = resolve_api_context() else {
        log::warn!("Presencia LAN: API no configurada (no se anuncia mDNS)");
        return;
    };

    let port = match ensure_lan_http_server().await {
        Ok(p) => p,
        Err(e) => {
            log::warn!("No se pudo iniciar servidor LAN: {e}");
            return;
        }
    };

    if let Err(e) = publish_lan_service(&device_id, &ctx.user_id, port) {
        log::warn!("mDNS presencia: {e}");
    }
}

pub fn spawn_lan_presence_advertiser() {
    tauri::async_runtime::spawn(async {
        ensure_lan_presence().await;
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            ensure_lan_presence().await;
        }
    });
}
