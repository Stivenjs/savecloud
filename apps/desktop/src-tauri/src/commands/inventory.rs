//! Comandos Tauri para inventario de juegos y transferencia LAN.

use serde::Serialize;
use tauri::command;

use crate::peer_inventory::{
    game_key_for_catalog_steam, list_providers_from_api, load_local_manifest,
    publish_local_inventory, GameProvidersResponseDto,
};
use crate::peer_lan::{poll_and_serve_pending_sessions, probe_lan_devices, LanDeviceProbe};
use crate::sources::commands::downloads::start_peer_game_download_inner;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalInventoryDto {
    pub manifest: Option<crate::peer_inventory::DeviceInventoryManifest>,
}

#[command]
pub async fn inventory_scan_and_publish(
    force_scan: bool,
) -> Result<crate::peer_inventory::DeviceInventoryManifest, String> {
    publish_local_inventory(force_scan).await
}

#[command]
pub fn inventory_get_local() -> Result<LocalInventoryDto, String> {
    Ok(LocalInventoryDto {
        manifest: load_local_manifest()?,
    })
}

#[command]
pub async fn inventory_list_providers(
    game_key: String,
) -> Result<GameProvidersResponseDto, String> {
    list_providers_from_api(&game_key).await
}

#[command]
pub async fn inventory_probe_lan(device_ids: Vec<String>) -> Result<Vec<LanDeviceProbe>, String> {
    probe_lan_devices(device_ids).await
}

#[command]
pub async fn inventory_poll_pending_sessions() -> Result<u32, String> {
    poll_and_serve_pending_sessions().await
}

#[command]
pub fn inventory_game_key_from_steam_app_id(
    steam_app_id: String,
) -> Result<Option<String>, String> {
    Ok(game_key_for_catalog_steam(&steam_app_id))
}

#[command]
pub async fn start_peer_game_download(
    app: tauri::AppHandle,
    game_key: String,
    title: String,
    destination_dir: String,
    target_user_id: String,
    target_device_id: String,
    manifest_hash: String,
) -> Result<String, String> {
    start_peer_game_download_inner(
        app,
        game_key,
        title,
        destination_dir,
        target_user_id,
        target_device_id,
        manifest_hash,
    )
    .await
}

#[command]
pub async fn set_share_game_inventory_with_cloud(enabled: bool) -> Result<(), String> {
    let mut settings = crate::config::load_settings();
    settings.share_game_inventory_with_cloud = enabled;
    crate::config::save_settings(&settings)?;
    if enabled {
        let _ = publish_local_inventory(true).await;
    } else if let Some(m) = load_local_manifest()? {
        let _ = crate::peer_inventory::delete_cloud_inventory(&m.device_id).await;
    }
    Ok(())
}
