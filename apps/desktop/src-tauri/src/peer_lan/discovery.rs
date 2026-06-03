//! Descubrimiento mDNS de dispositivos SaveCloud en LAN.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;

use serde::Serialize;

const SERVICE_TYPE: &str = "_savecloud._tcp.local.";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanDeviceProbe {
    pub device_id: String,
    pub user_id: String,
    pub lan_host: String,
    pub port: u16,
    pub reachable: bool,
}

/// Sondea la LAN y devuelve dispositivos cuyo `deviceId` está en `target_ids`.
pub async fn probe_lan_devices(target_ids: Vec<String>) -> Result<Vec<LanDeviceProbe>, String> {
    let wanted: std::collections::HashSet<String> = target_ids.into_iter().collect();
    if wanted.is_empty() {
        return Ok(Vec::new());
    }

    let mut found: HashMap<String, LanDeviceProbe> = HashMap::new();

    let daemon = mdns_sd::ServiceDaemon::new().map_err(|e| format!("mDNS daemon: {e}"))?;
    let receiver = daemon
        .browse(SERVICE_TYPE)
        .map_err(|e| format!("mDNS browse: {e}"))?;

    let deadline = std::time::Instant::now() + Duration::from_secs(8);
    let mut seen_services = 0_u32;

    while std::time::Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                seen_services += 1;
                if let Some(probe) = probe_from_service(&info, &wanted) {
                    found.insert(probe.device_id.clone(), probe);
                }
            }
            Ok(mdns_sd::ServiceEvent::ServiceFound(_, _)) => {
                seen_services += 1;
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }

    let _ = daemon.shutdown();

    log::info!(
        "mDNS probe: {} servicio(s) vistos, {} de {} dispositivo(s) alcanzables",
        seen_services,
        found.len(),
        wanted.len()
    );

    let out: Vec<LanDeviceProbe> = wanted
        .into_iter()
        .map(|id| {
            found.get(&id).cloned().unwrap_or(LanDeviceProbe {
                device_id: id,
                user_id: String::new(),
                lan_host: String::new(),
                port: 0,
                reachable: false,
            })
        })
        .collect();

    Ok(out)
}

fn probe_from_service(
    info: &mdns_sd::ServiceInfo,
    wanted: &std::collections::HashSet<String>,
) -> Option<LanDeviceProbe> {
    let device_id = txt_get(info, "deviceId");
    if device_id.is_empty() || !wanted.contains(&device_id) {
        return None;
    }
    let port = info.get_port();
    if port == 0 {
        return None;
    }
    let host = resolve_lan_host(info);
    if host.is_empty() {
        return None;
    }
    Some(LanDeviceProbe {
        device_id,
        user_id: txt_get(info, "userId"),
        lan_host: host,
        port,
        reachable: true,
    })
}

fn txt_get(info: &mdns_sd::ServiceInfo, key: &str) -> String {
    info.get_properties()
        .get(key)
        .and_then(|v| v.val())
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .unwrap_or_default()
}

fn resolve_lan_host(info: &mdns_sd::ServiceInfo) -> String {
    for ip in info.get_addresses() {
        if let IpAddr::V4(v4) = ip {
            if !v4.is_loopback() {
                return v4.to_string();
            }
        }
    }
    for ip in info.get_addresses() {
        if let IpAddr::V6(v6) = ip {
            return format!("[{v6}]");
        }
    }
    info.get_hostname().trim_end_matches('.').to_string()
}
