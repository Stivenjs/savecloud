//! Runner de descarga peer LAN (cola sources).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};

use crate::commands::sync::context::resolve_api_context;
use crate::network::stream_download::{stream_url_to_file, GlobalDownloadProgress};
use crate::network::{API_CLIENT, PEER_LAN_CLIENT};
use crate::peer_inventory::{list_providers_from_api, InventoryFileDto};
use crate::peer_lan::discovery::{probe_lan_devices, LanDeviceProbe};
use crate::utils::transfer_metrics::TransferSpeedTracker;

pub struct PeerDownloadParams {
    pub game_key: String,
    pub destination_dir: String,
    pub target_user_id: String,
    pub target_device_id: String,
    pub manifest_hash: String,
}

const FILE_DOWNLOAD_ATTEMPTS: u32 = 3;
const SESSION_READY_MAX_WAIT: Duration = Duration::from_secs(45);

pub async fn run_peer_download(
    params: PeerDownloadParams,
    cancel_flag: Arc<AtomicBool>,
    mut on_progress: impl FnMut(u64, u64, u64, Option<u64>) -> Result<(), String>,
) -> Result<(), String> {
    let session = create_transfer_session(&params).await?;

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

    let sample_rel = files[0].relative_path.replace('\\', "/");
    let peer = wait_for_transfer_peer(
        &params.target_device_id,
        &session.token,
        &sample_rel,
        &cancel_flag,
    )
    .await?;

    let dest = PathBuf::from(&params.destination_dir);
    tokio::fs::create_dir_all(&dest)
        .await
        .map_err(|e| e.to_string())?;

    let total_bytes: u64 = files.iter().map(|f| f.size).sum();
    let mut loaded_total = 0_u64;
    let mut speed_tracker = TransferSpeedTracker::new();

    let client = PEER_LAN_CLIENT.clone();
    let base = format!("http://{}:{}", peer.lan_host, peer.port);

    for file in &files {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("stopped_by_user".to_string());
        }
        let rel = file.relative_path.replace('\\', "/");
        let url = format!("{base}/files/{}", encode_url_path(&rel));
        let out = dest.join(&rel);
        if let Some(parent) = out.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }

        let file_offset = loaded_total;
        let mut last_err = String::new();
        for attempt in 1..=FILE_DOWNLOAD_ATTEMPTS {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err("stopped_by_user".to_string());
            }
            match stream_url_to_file(
                &client,
                &url,
                &out,
                file.size,
                Some(&session.token),
                cancel_flag.clone(),
                &mut speed_tracker,
                GlobalDownloadProgress {
                    loaded_offset: file_offset,
                    total_bytes,
                },
                |loaded, _total, speed, eta| {
                    on_progress(file_offset.saturating_add(loaded), total_bytes, speed, eta)
                },
            )
            .await
            {
                Ok(result) => {
                    loaded_total = loaded_total.saturating_add(result.loaded);
                    let sample = speed_tracker.published_sample();
                    on_progress(
                        loaded_total,
                        total_bytes,
                        sample.download_speed_bytes,
                        sample.eta_seconds,
                    )?;
                    last_err.clear();
                    break;
                }
                Err(e) => {
                    last_err = e;
                    let _ = tokio::fs::remove_file(&out).await;
                    if attempt < FILE_DOWNLOAD_ATTEMPTS && is_retryable_transfer_error(&last_err) {
                        log::warn!(
                            "Reintento peer LAN {attempt}/{FILE_DOWNLOAD_ATTEMPTS} para {rel}: {last_err}"
                        );
                        tokio::time::sleep(Duration::from_secs(if last_err.contains("404") {
                            4
                        } else {
                            2
                        }))
                        .await;
                        continue;
                    }
                    return Err(format!("Falló {rel}: {last_err}"));
                }
            }
        }
        if !last_err.is_empty() {
            return Err(format!("Falló {rel}: {last_err}"));
        }
    }

    let _ = session;
    Ok(())
}

async fn wait_for_transfer_peer(
    target_device_id: &str,
    session_token: &str,
    sample_relative_path: &str,
    cancel_flag: &AtomicBool,
) -> Result<LanDeviceProbe, String> {
    let deadline = std::time::Instant::now() + SESSION_READY_MAX_WAIT;

    while std::time::Instant::now() < deadline {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("stopped_by_user".to_string());
        }

        let probes = probe_lan_devices(vec![target_device_id.to_string()]).await?;
        if let Some(peer) = probes.into_iter().find(|p| {
            p.device_id == target_device_id && p.reachable && !p.lan_host.is_empty() && p.port > 0
        }) {
            let base = format!("http://{}:{}", peer.lan_host, peer.port);
            if peer_serves_file(&base, session_token, sample_relative_path).await {
                log::info!(
                    "Peer LAN listo en {}:{} para transferencia",
                    peer.lan_host,
                    peer.port
                );
                return Ok(peer);
            }
        }

        tokio::time::sleep(Duration::from_millis(750)).await;
    }

    Err(
        "El dispositivo no preparó la transferencia a tiempo. Deja SaveCloud abierto en el otro PC."
            .to_string(),
    )
}

async fn peer_serves_file(base: &str, token: &str, relative_path: &str) -> bool {
    let url = format!("{base}/files/{}", encode_url_path(relative_path));
    let mut headers = HeaderMap::new();
    if let Ok(value) = HeaderValue::from_str(&format!("Bearer {token}")) {
        headers.insert(AUTHORIZATION, value);
    }

    match PEER_LAN_CLIENT.head(&url).headers(headers).send().await {
        Ok(res) => res.status().is_success(),
        Err(_) => false,
    }
}

fn encode_url_path(relative_path: &str) -> String {
    relative_path
        .split('/')
        .map(urlencoding::encode)
        .map(|s| s.into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn is_retryable_transfer_error(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("error http")
        || lower.contains("http 404")
        || lower.contains("archivo no encontrado")
        || lower.contains("error leyendo stream")
        || lower.contains("connection")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("broken pipe")
        || lower.contains("reset")
        || lower.contains("503")
        || lower.contains("502")
        || lower.contains("401")
}

#[derive(Debug, serde::Deserialize)]
struct TransferSessionDto {
    token: String,
}

async fn create_transfer_session(
    params: &PeerDownloadParams,
) -> Result<TransferSessionDto, String> {
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
