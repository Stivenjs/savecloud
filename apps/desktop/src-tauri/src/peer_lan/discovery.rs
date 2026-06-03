//! Descubrimiento mDNS de dispositivos SaveCloud en LAN.

use std::collections::HashMap;
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

    let deadline = std::time::Instant::now() + Duration::from_secs(3);

    while std::time::Instant::now() < deadline {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(mdns_sd::ServiceEvent::ServiceResolved(info)) => {
                let device_id = txt_get(&info, "deviceId");
                let user_id = txt_get(&info, "userId");
                if device_id.is_empty() || !wanted.contains(&device_id) {
                    continue;
                }
                let host = info.get_hostname().trim_end_matches('.').to_string();
                let port = info.get_port();
                found.insert(
                    device_id.clone(),
                    LanDeviceProbe {
                        device_id,
                        user_id,
                        lan_host: host,
                        port,
                        reachable: true,
                    },
                );
            }
            Ok(_) => {}
            Err(_) => break,
        }
    }

    let _ = daemon.shutdown();

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

fn txt_get(info: &mdns_sd::ServiceInfo, key: &str) -> String {
    info.get_properties()
        .get(key)
        .and_then(|v| v.val())
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
        .unwrap_or_default()
}
