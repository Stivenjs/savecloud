//! Runner de descarga peer LAN (cola sources).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::commands::sync::context::resolve_api_context;
use crate::network::stream_download::stream_url_to_file;
use crate::network::API_CLIENT;
use crate::peer_inventory::{list_providers_from_api, InventoryFileDto};

pub struct PeerDownloadParams {
    pub game_key: String,
    pub destination_dir: String,
    pub target_user_id: String,
    pub target_device_id: String,
    pub manifest_hash: String,
}

pub async fn run_peer_download(
    params: PeerDownloadParams,
    cancel_flag: Arc<AtomicBool>,
    mut on_progress: impl FnMut(u64, u64, u64, Option<u64>) -> Result<(), String>,
) -> Result<(), String> {
    let session = create_transfer_session(&params).await?;

    for _ in 0..20 {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("stopped_by_user".to_string());
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    let probes = crate::peer_lan::discovery::probe_lan_devices(vec![params.target_device_id.clone()])
        .await?;
    let peer = probes
        .into_iter()
        .find(|p| p.device_id == params.target_device_id && p.reachable)
        .ok_or_else(|| {
            "El dispositivo no está disponible en la red local. Enciéndelo en la misma red.".to_string()
        })?;

    let providers = list_providers_from_api(&params.game_key).await?;
    let provider = providers
        .providers
        .into_iter()
        .find(|p| p.device_id == params.target_device_id)
        .ok_or_else(|| "Proveedor no encontrado en inventario".to_string())?;

    let files: Vec<InventoryFileDto> = provider.files.unwrap_or_default();
    if files.is_empty() {
        return Err("El proveedor no tiene archivos indexados para este juego".to_string());
    }

    let dest = PathBuf::from(&params.destination_dir);
    tokio::fs::create_dir_all(&dest)
        .await
        .map_err(|e| e.to_string())?;

    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    let mut loaded_total = 0_u64;

    let client = API_CLIENT.clone();
    let base = format!("http://{}:{}", peer.lan_host, peer.port);

    for file in &files {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("stopped_by_user".to_string());
        }
        let rel = file.relative_path.replace('\\', "/");
        let url = format!("{base}/files/{rel}");
        let out = dest.join(&rel);
        if let Some(parent) = out.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }

        let file_offset = loaded_total;
        let result = stream_url_to_file(
            &client,
            &url,
            &out,
            file.size,
            Some(&session.token),
            cancel_flag.clone(),
            |loaded, _total, speed, eta| {
                on_progress(
                    file_offset.saturating_add(loaded),
                    total_bytes,
                    speed,
                    eta,
                )
            },
        )
        .await?;

        loaded_total = loaded_total.saturating_add(result.loaded);
        on_progress(loaded_total, total_bytes, 0, None)?;
    }

    let _ = session;
    Ok(())
}

#[derive(Debug, serde::Deserialize)]
struct TransferSessionDto {
    token: String,
}

async fn create_transfer_session(params: &PeerDownloadParams) -> Result<TransferSessionDto, String> {
    let ctx = resolve_api_context()?;

    let body = serde_json::json!({
        "targetUserId": params.target_user_id,
        "targetDeviceId": params.target_device_id,
        "gameKey": params.game_key,
        "manifestHash": params.manifest_hash,
    });

    let url = format!("{}/inventory/transfer-sessions", ctx.base_url);
    let res = API_CLIENT
        .post(&url)
        .header("x-api-key", &ctx.api_key)
        .header("x-user-id", &ctx.user_id)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Sesión transferencia: {text}"));
    }

    res.json::<TransferSessionDto>()
        .await
        .map_err(|e| e.to_string())
}
