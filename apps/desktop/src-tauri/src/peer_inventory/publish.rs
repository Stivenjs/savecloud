//! Publicación del manifiesto al API cloud.

use crate::commands::sync::context::resolve_api_context;
use crate::config::load_settings;
use crate::network::API_CLIENT;

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
    let ctx = resolve_api_context()?;
    let url = format!(
        "{}/inventory/devices/{}",
        ctx.base_url,
        urlencoding::encode(&manifest.device_id)
    );
    let body = manifest.to_publish_body();

    let client = API_CLIENT.clone();
    let res = client
        .put(&url)
        .header("x-api-key", &ctx.api_key)
        .header("x-user-id", &ctx.user_id)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Error publicando inventario: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Inventario rechazado ({status}): {text}"));
    }
    Ok(())
}

pub async fn post_cloud_heartbeat(device_id: &str) -> Result<(), String> {
    let ctx = resolve_api_context()?;
    let url = format!(
        "{}/inventory/devices/{}/heartbeat",
        ctx.base_url,
        urlencoding::encode(device_id)
    );
    let body = serde_json::json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
    });

    let client = API_CLIENT.clone();
    let res = client
        .post(&url)
        .header("x-api-key", &ctx.api_key)
        .header("x-user-id", &ctx.user_id)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Heartbeat inventario: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Heartbeat rechazado ({status}): {text}"));
    }
    Ok(())
}

pub async fn delete_cloud_inventory(device_id: &str) -> Result<(), String> {
    let ctx = resolve_api_context()?;
    let url = format!(
        "{}/inventory/devices/{}",
        ctx.base_url,
        urlencoding::encode(device_id)
    );
    let client = API_CLIENT.clone();
    let res = client
        .delete(&url)
        .header("x-api-key", &ctx.api_key)
        .header("x-user-id", &ctx.user_id)
        .send()
        .await
        .map_err(|e| format!("Error borrando inventario: {e}"))?;

    if !res.status().is_success() && res.status() != reqwest::StatusCode::NOT_FOUND {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("DELETE inventario ({status}): {text}"));
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
    let ctx = resolve_api_context()?;
    let url = format!(
        "{}/inventory/providers?gameKey={}",
        ctx.base_url,
        urlencoding::encode(game_key)
    );
    let client = API_CLIENT.clone();
    let res = client
        .get(&url)
        .header("x-api-key", &ctx.api_key)
        .header("x-user-id", &ctx.user_id)
        .send()
        .await
        .map_err(|e| format!("Error listando proveedores: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();
        return Err(format!("Proveedores ({status}): {text}"));
    }

    res.json::<GameProvidersResponseDto>()
        .await
        .map_err(|e| format!("JSON proveedores: {e}"))
}
