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
use crate::peer_lan::checkpoint::{PeerDownloadCheckpoint, PeerJobMeta, PAUSED_BY_USER};
use crate::peer_lan::discovery::{probe_lan_devices, LanDeviceProbe};
use crate::utils::transfer_metrics::TransferSpeedTracker;

pub struct PeerDownloadParams {
    pub game_key: String,
    pub destination_dir: String,
    pub target_user_id: String,
    pub target_device_id: String,
    pub manifest_hash: String,
    pub checkpoint: Option<PeerDownloadCheckpoint>,
}



const FILE_DOWNLOAD_ATTEMPTS: u32 = 3;
const SESSION_READY_MAX_WAIT: Duration = Duration::from_secs(45);

pub async fn run_peer_download(
    params: PeerDownloadParams,
    cancel_flag: Arc<AtomicBool>,
    pause_flag: Arc<AtomicBool>,
    mut on_progress: impl FnMut(u64, u64, u64, Option<u64>) -> Result<(), String>,
) -> Result<(), String> {
    let files = fetch_file_list(&params).await?;
    let total_bytes: u64 = files.iter().map(|f| f.size).sum();

    let start_index = params
        .checkpoint
        .as_ref()
        .map(|c| c.next_file_index)
        .unwrap_or(0);
    let mut loaded_total = params
        .checkpoint
        .as_ref()
        .map(|c| c.loaded_total)
        .unwrap_or(0);

    if start_index >= files.len() && total_bytes > 0 && loaded_total >= total_bytes {
        return Ok(());
    }

    let session_token = match params
        .checkpoint
        .as_ref()
        .and_then(|c| c.session_token.clone())
    {
        Some(token) if !token.is_empty() => token,
        _ => create_transfer_session(&params).await?.token,
    };

    let sample_rel = files
        .get(start_index)
        .or_else(|| files.first())
        .map(|f| f.relative_path.replace('\\', "/"))
        .ok_or_else(|| "Sin archivos en el manifiesto del proveedor".to_string())?;

    let peer = wait_for_transfer_peer(
        &params.target_device_id,
        &session_token,
        &sample_rel,
        &cancel_flag,
        &pause_flag,
    )
    .await?;

    let dest = PathBuf::from(&params.destination_dir);
    tokio::fs::create_dir_all(&dest)
        .await
        .map_err(|e| e.to_string())?;

    let mut speed_tracker = TransferSpeedTracker::new();
    let client = PEER_LAN_CLIENT.clone();
    let base = format!("https://{}:{}", peer.lan_host, peer.port);

    for (index, file) in files.iter().enumerate().skip(start_index) {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("stopped_by_user".to_string());
        }
        if pause_flag.load(Ordering::Relaxed) {
            return Err(build_pause_error(index, loaded_total, &session_token));
        }

        let rel = file.relative_path.replace('\\', "/");
        let out = dest.join(&rel);

        if file_already_complete(&out, file.size).await? {
            loaded_total = loaded_total.saturating_add(file.size);
            on_progress(
                loaded_total,
                total_bytes,
                speed_tracker.published_sample().download_speed_bytes,
                speed_tracker.published_sample().eta_seconds,
            )?;
            continue;
        }

        if let Some(parent) = out.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| e.to_string())?;
        }

        let url = format!("{base}/files/{}", encode_url_path(&rel));
        let file_offset = loaded_total;
        let mut last_err = String::new();

        for attempt in 1..=FILE_DOWNLOAD_ATTEMPTS {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err("stopped_by_user".to_string());
            }
            if pause_flag.load(Ordering::Relaxed) {
                return Err(build_pause_error(index, loaded_total, &session_token));
            }

            match stream_url_to_file(
                &client,
                &url,
                &out,
                file.size,
                Some(&session_token),
                cancel_flag.clone(),
                Some(pause_flag.clone()),
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
                Err(e) if e == crate::network::stream_download::STREAM_PAUSED_BY_USER => {
                    return Err(build_pause_error(index, loaded_total, &session_token));
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

    Ok(())
}

fn build_pause_error(index: usize, loaded_total: u64, session_token: &str) -> String {
    let checkpoint = PeerDownloadCheckpoint {
        next_file_index: index,
        loaded_total,
        session_token: Some(session_token.to_string()),
    };
    format!(
        "{PAUSED_BY_USER}:{}",
        serde_json::to_string(&checkpoint).unwrap_or_default()
    )
}

async fn file_already_complete(path: &std::path::Path, expected_size: u64) -> Result<bool, String> {
    let meta = match tokio::fs::metadata(path).await {
        Ok(m) => m,
        Err(_) => return Ok(false),
    };
    Ok(meta.is_file() && meta.len() == expected_size)
}

async fn fetch_file_list(params: &PeerDownloadParams) -> Result<Vec<InventoryFileDto>, String> {
    let providers = list_providers_from_api(&params.game_key).await?;
    let provider = providers
        .providers
        .into_iter()
        .find(|p| p.device_id == params.target_device_id)
        .ok_or_else(|| "Proveedor no encontrado en inventario".to_string())?;

    let files = provider.files.unwrap_or_default();
    if files.is_empty() {
        return Err("El proveedor no tiene archivos indexados para este juego".to_string());
    }
    Ok(files)
}

async fn wait_for_transfer_peer(
    target_device_id: &str,
    session_token: &str,
    sample_relative_path: &str,
    cancel_flag: &AtomicBool,
    pause_flag: &AtomicBool,
) -> Result<LanDeviceProbe, String> {
    let deadline = std::time::Instant::now() + SESSION_READY_MAX_WAIT;

    while std::time::Instant::now() < deadline {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("stopped_by_user".to_string());
        }
        if pause_flag.load(Ordering::Relaxed) {
            return Err(build_pause_error(0, 0, session_token));
        }

        let probes = probe_lan_devices(vec![target_device_id.to_string()]).await?;
        if let Some(peer) = probes.into_iter().find(|p| {
            p.device_id == target_device_id && p.reachable && !p.lan_host.is_empty() && p.port > 0
        }) {
            let base = format!("https://{}:{}", peer.lan_host, peer.port);
            if peer_serves_file(&base, session_token, sample_relative_path).await {
                log::info!(
                    "Peer LAN listo en {}:{} para transferencia HTTPS",
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

/// Parsea error de pausa y devuelve checkpoint si aplica.
pub fn parse_pause_checkpoint(err: &str) -> Option<PeerDownloadCheckpoint> {
    let rest = err.strip_prefix(&format!("{PAUSED_BY_USER}:"))?;
    serde_json::from_str(rest).ok()
}

pub fn peer_meta_from_job_uri(uri: &str) -> Result<PeerJobMeta, String> {
    PeerJobMeta::parse(uri)
}

pub fn apply_checkpoint_to_meta(
    meta: &mut PeerJobMeta,
    checkpoint: PeerDownloadCheckpoint,
) -> Result<String, String> {
    meta.checkpoint = Some(checkpoint);
    meta.to_json()
}
