//! Presencia LAN: anuncia el dispositivo en mDNS mientras comparte inventario.

use std::sync::Mutex;
use std::time::Duration;

use axum::{routing::get, Router};
use once_cell::sync::Lazy;

use crate::commands::sync::context::resolve_api_context;
use crate::config::load_settings;
use crate::peer_inventory::resolve_device_id;
use crate::peer_lan::mdns_registry::{publish_lan_service, withdraw_lan_service};

static PRESENCE: Lazy<Mutex<Option<PresenceState>>> = Lazy::new(|| Mutex::new(None));

struct PresenceState {
    port: u16,
    handle: tokio::task::JoinHandle<()>,
}

async fn start_presence_server() -> Result<u16, String> {
    let app = Router::new().route("/health", get(|| async { "ok" }));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Presencia LAN: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let handle = tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log::warn!("Servidor presencia LAN finalizado: {e}");
        }
    });
    if let Ok(mut guard) = PRESENCE.lock() {
        *guard = Some(PresenceState { port, handle });
    }
    Ok(port)
}

fn stop_presence_server() {
    if let Ok(mut guard) = PRESENCE.lock() {
        if let Some(state) = guard.take() {
            state.handle.abort();
        }
    }
}

async fn refresh_presence_advertisement() {
    let settings = load_settings();
    if !settings.share_game_inventory_with_cloud {
        stop_presence_server();
        withdraw_lan_service();
        return;
    }

    let Ok(device_id) = resolve_device_id() else {
        return;
    };
    let Ok(ctx) = resolve_api_context() else {
        return;
    };

    let port = {
        let needs_start = PRESENCE
            .lock()
            .ok()
            .map(|g| g.is_none())
            .unwrap_or(true);
        if needs_start {
            match start_presence_server().await {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("No se pudo iniciar presencia LAN: {e}");
                    return;
                }
            }
        } else {
            PRESENCE
                .lock()
                .ok()
                .and_then(|g| g.as_ref().map(|s| s.port))
                .unwrap_or(0)
        }
    };

    if port == 0 {
        return;
    }

    if let Err(e) = publish_lan_service(&device_id, &ctx.user_id, port) {
        log::warn!("mDNS presencia: {e}");
    }
}

/// Vuelve a anunciar el puerto de presencia tras cerrar el servidor de transferencia.
pub async fn republish_presence_after_transfer() {
    refresh_presence_advertisement().await;
}

pub fn spawn_lan_presence_advertiser() {
    tauri::async_runtime::spawn(async {
        loop {
            refresh_presence_advertisement().await;
            tokio::time::sleep(Duration::from_secs(10)).await;
        }
    });
}
