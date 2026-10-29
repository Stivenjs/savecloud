//! Publicación del manifiesto al API cloud.

use crate::cloud::{api_error, cloud_api};
use crate::config::load_settings;

use super::models::DeviceInventoryManifest;
use super::scanner::scan_full_inventory;
use super::store::load_local_manifest;

pub async fn publish_local_inventory(force_scan: bool) -> Result<DeviceInventoryManifest, String> {
    let settings = load_settings();
    let sharing = settings.share_game_inventory_with_cloud;
    let user_id = settings
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "userId no configurado".to_string())?;

    let manifest = if force_scan {
        scan_full_inventory(&user_id, sharing)?
    } else if let Some(local) = load_local_manifest()? {
        local
    } else {
        scan_full_inventory(&user_id, sharing)?
    };

    if sharing {
        put_cloud_manifest(&manifest).await?;
        let _ = post_cloud_heartbeat(&manifest.device_id).await;
        crate::peer_lan::ensure_lan_presence().await;
    } else {
        delete_cloud_inventory(&manifest.device_id).await.ok();
        crate::peer_lan::ensure_lan_presence().await;
    }

    Ok(manifest)
}

pub async fn publish_manifest_to_cloud(manifest: &DeviceInventoryManifest) -> Result<(), String> {
    put_cloud_manifest(manifest).await
}

async fn put_cloud_manifest(manifest: &DeviceInventoryManifest) -> Result<(), String> {
    let tls_fingerprint = if manifest.sharing_enabled {
        crate::peer_lan::ensure_lan_presence().await;
        Some(
            crate::peer_lan::server::lan_tls_fingerprint().ok_or_else(|| {
                "No se pudo iniciar TLS para compartir el inventario LAN".to_string()
            })?,
        )
    } else {
        None
    };
    let path = format!(
        "/inventory/devices/{}",
        urlencoding::encode(&manifest.device_id)
    );
    let body = manifest.to_publish_body(tls_fingerprint);

    let res = cloud_api(reqwest::Method::PUT, &path)
        .json(&body)?
        .send()
        .await
        .map_err(|_| api_error::network_message())?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

pub async fn post_cloud_heartbeat(device_id: &str) -> Result<(), String> {
    let path = format!(
        "/inventory/devices/{}/heartbeat",
        urlencoding::encode(device_id)
    );
    let body = serde_json::json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
    });

    let res = cloud_api(reqwest::Method::POST, &path)
        .json(&body)?
        .send()
        .await
        .map_err(|_| api_error::network_message())?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

pub async fn delete_cloud_inventory(device_id: &str) -> Result<(), String> {
    let path = format!(
        "/inventory/devices/{}",
        urlencoding::encode(device_id)
    );
    let res = cloud_api(reqwest::Method::DELETE, &path)
        .send()
        .await
        .map_err(|_| api_error::network_message())?;

    if !res.status().is_success() && res.status() != reqwest::StatusCode::NOT_FOUND {
        return Err(api_error::response_message(res).await);
    }
    Ok(())
}

#[derive(Debug, serde::Deserialize, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InventoryFileDto {
    pub relative_path: String,
    pub size: u64,
    pub hash: String,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameProviderDeviceDto {
    pub user_id: String,
    pub device_id: String,
    pub device_name: String,
    pub total_bytes: u64,
    pub payload_kind: String,
    pub manifest_hash: String,
    pub verified_at: String,
    pub last_seen_at: Option<String>,
    pub tls_fingerprint: Option<String>,
    #[serde(default)]
    pub files: Option<Vec<InventoryFileDto>>,
}

#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameProvidersResponseDto {
    pub game_key: String,
    pub providers: Vec<GameProviderDeviceDto>,
}

pub async fn list_providers_from_api(game_key: &str) -> Result<GameProvidersResponseDto, String> {
    let path = format!(
        "/inventory/providers?gameKey={}",
        urlencoding::encode(game_key)
    );
    let res = cloud_api(reqwest::Method::GET, &path)
        .send()
        .await
        .map_err(|_| api_error::network_message())?;

    if !res.status().is_success() {
        return Err(api_error::response_message(res).await);
    }

    res.json::<GameProvidersResponseDto>()
        .await
        .map_err(|e| format!("JSON proveedores: {e}"))
}
