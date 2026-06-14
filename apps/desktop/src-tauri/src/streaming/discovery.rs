#![allow(dead_code)]
//! Descubrimiento de hosts de streaming en la red local (mDNS).
//!
//! Publica y descubre servicios `_savecloud-stream._tcp.local.` para
//! encontrar otros miembros de SaveCloud que estén transmitiendo un juego.

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::sync::Mutex;

const STREAM_SERVICE_TYPE: &str = "_savecloud-stream._tcp.local.";

static MDNS_DAEMON: Lazy<Mutex<Option<ServiceDaemon>>> = Lazy::new(|| Mutex::new(None));
static LAST_PUBLISHED: Lazy<Mutex<Option<(String, u16)>>> = Lazy::new(|| Mutex::new(None));

fn daemon() -> Result<std::sync::MutexGuard<'static, Option<ServiceDaemon>>, String> {
    MDNS_DAEMON.lock().map_err(|e| format!("mDNS lock: {}", e))
}

fn primary_lan_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("1.1.1.1:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(v4),
        _ => None,
    }
}

/// Estructura que representa un host de streaming descubierto en la LAN.
#[derive(Debug, Clone, serde::Serialize)]
pub struct DiscoveredStreamHost {
    pub device_id: String,
    pub user_id: String,
    pub ip: String,
    pub port: u16,
    pub savecloud_port: u16,
    pub hostname: String,
}

/// Publica la intención de este PC de ser un host de streaming.
pub fn publish_stream_service(
    device_id: &str,
    user_id: &str,
    sunshine_port: u16,
    savecloud_port: u16,
) -> Result<(), String> {
    if sunshine_port == 0 {
        return Ok(());
    }

    if let Ok(guard) = LAST_PUBLISHED.lock() {
        if guard
            .as_ref()
            .is_some_and(|(id, p)| id == device_id && *p == sunshine_port)
        {
            return Ok(());
        }
    }

    let mut guard = daemon()?;
    if guard.is_none() {
        *guard = Some(ServiceDaemon::new().map_err(|e| format!("mDNS daemon: {}", e))?);
    }
    let daemon = guard.as_ref().expect("daemon just set");

    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let instance = format!("stream-{device_id}");

    let mut properties = HashMap::new();
    properties.insert("deviceId".to_string(), device_id.to_string());
    properties.insert("userId".to_string(), user_id.to_string());
    properties.insert("savecloudPort".to_string(), savecloud_port.to_string());

    let host_ip = primary_lan_ipv4()
        .map(|v4| v4.to_string())
        .unwrap_or_default();

    let info = ServiceInfo::new(
        STREAM_SERVICE_TYPE,
        &instance,
        &format!("{host}.local."),
        &host_ip,
        sunshine_port,
        properties,
    )
    .map_err(|e| format!("mDNS ServiceInfo: {}", e))?;

    daemon
        .register(info)
        .map_err(|e| format!("mDNS register: {}", e))?;

    if let Ok(mut last) = LAST_PUBLISHED.lock() {
        *last = Some((device_id.to_string(), sunshine_port));
    }

    log::info!(
        "Host de streaming publicado: device={} ip={} port={} savecloud_port={}",
        device_id,
        host_ip,
        sunshine_port,
        savecloud_port
    );
    Ok(())
}

/// Retira el anuncio mDNS de streaming de este PC.
pub fn withdraw_stream_service() {
    if let Ok(mut last) = LAST_PUBLISHED.lock() {
        *last = None;
    }

    if let Ok(mut guard) = daemon() {
        if let Some(daemon) = guard.as_ref() {
            let _ = daemon.shutdown();
        }
        *guard = None;
    }
    log::info!("Host de streaming retirado");
}

/// Busca hosts de streaming en la LAN durante `timeout_secs` segundos.
pub async fn discover_stream_hosts(timeout_secs: u64) -> Result<Vec<DiscoveredStreamHost>, String> {
    let d = ServiceDaemon::new().map_err(|e| format!("Fallo al iniciar mDNS: {}", e))?;
    let receiver = d
        .browse(STREAM_SERVICE_TYPE)
        .map_err(|e| format!("mDNS browse: {}", e))?;

    let mut hosts = Vec::new();
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(timeout_secs);

    while start.elapsed() < timeout {
        if let Ok(event) = receiver.recv_timeout(std::time::Duration::from_millis(500)) {
            if let ServiceEvent::ServiceResolved(info) = event {
                let properties = info.get_properties();

                let device_id = properties
                    .get("deviceId")
                    .map(|v| v.val_str().to_string())
                    .unwrap_or_default();

                let user_id = properties
                    .get("userId")
                    .map(|v| v.val_str().to_string())
                    .unwrap_or_default();

                let savecloud_port = properties
                    .get("savecloudPort")
                    .and_then(|v| v.val_str().parse::<u16>().ok())
                    .unwrap_or(0);

                let ip = info
                    .get_addresses()
                    .iter()
                    .next()
                    .map(|ip| ip.to_string())
                    .unwrap_or_default();

                if !device_id.is_empty() && !ip.is_empty() {
                    hosts.push(DiscoveredStreamHost {
                        device_id,
                        user_id,
                        ip,
                        port: info.get_port(),
                        savecloud_port,
                        hostname: info.get_hostname().to_string(),
                    });
                }
            }
        }
    }

    let _ = d.shutdown();
    Ok(hosts)
}
