//! Comandos Tauri para inventario de juegos y transferencia LAN.

use serde::Serialize;
use tauri::command;

use std::path::Path;

use crate::peer_inventory::publish::publish_manifest_to_cloud;
use crate::peer_inventory::{
    game_key_for_catalog_steam, list_providers_from_api, load_local_manifest,
    publish_local_inventory, register_manual_install_folder, GameProvidersResponseDto,
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
pub async fn inventory_register_install_folder(
    steam_app_id: String,
    display_name: String,
    folder_path: String,
) -> Result<crate::peer_inventory::DeviceInventoryManifest, String> {
    let settings = crate::config::load_settings();
    let user_id = settings
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "userId no configurado".to_string())?;

    let manifest = register_manual_install_folder(
        &user_id,
        settings.share_game_inventory_with_cloud,
        &steam_app_id,
        &display_name,
        Path::new(&folder_path),
    )?;

    if settings.share_game_inventory_with_cloud {
        publish_manifest_to_cloud(&manifest).await?;
        let _ = crate::peer_inventory::publish::post_cloud_heartbeat(&manifest.device_id).await;
        crate::peer_lan::ensure_lan_presence().await;
    }

    Ok(manifest)
}

#[command]
pub async fn inventory_unregister_install_folder(
    game_key: String,
) -> Result<crate::peer_inventory::DeviceInventoryManifest, String> {
    let settings = crate::config::load_settings();
    let user_id = settings
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "userId no configurado".to_string())?;

    let manifest = crate::peer_inventory::unregister_manual_install_folder(
        &user_id,
        settings.share_game_inventory_with_cloud,
        &game_key,
    )?;

    if settings.share_game_inventory_with_cloud {
        publish_manifest_to_cloud(&manifest).await?;
        let _ = crate::peer_inventory::publish::post_cloud_heartbeat(&manifest.device_id).await;
        crate::peer_lan::ensure_lan_presence().await;
    }

    Ok(manifest)
}

#[command]
pub async fn set_share_game_inventory_with_cloud(enabled: bool) -> Result<(), String> {
    let mut settings = crate::config::load_settings();
    settings.share_game_inventory_with_cloud = enabled;
    crate::config::save_settings(&settings)?;
    if enabled {
        let _ = publish_local_inventory(true).await;
    } else {
        if let Some(m) = load_local_manifest()? {
            let _ = crate::peer_inventory::delete_cloud_inventory(&m.device_id).await;
        }
        crate::peer_lan::ensure_lan_presence().await;
    }
    Ok(())
}
