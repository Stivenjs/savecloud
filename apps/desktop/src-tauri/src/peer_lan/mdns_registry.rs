//! Registro mDNS persistente (`_savecloud._tcp`).

use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::sync::Mutex;

use once_cell::sync::Lazy;

const SERVICE_TYPE: &str = "_savecloud._tcp.local.";

static MDNS_DAEMON: Lazy<Mutex<Option<mdns_sd::ServiceDaemon>>> = Lazy::new(|| Mutex::new(None));
static LAST_PUBLISHED: Lazy<Mutex<Option<(String, u16)>>> = Lazy::new(|| Mutex::new(None));

fn daemon() -> Result<std::sync::MutexGuard<'static, Option<mdns_sd::ServiceDaemon>>, String> {
    MDNS_DAEMON.lock().map_err(|e| format!("mDNS lock: {e}"))
}

fn primary_lan_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("1.1.1.1:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(v4),
        _ => None,
    }
}

pub fn publish_lan_service(device_id: &str, user_id: &str, port: u16) -> Result<(), String> {
    if port == 0 {
        return Ok(());
    }

    if let Ok(guard) = LAST_PUBLISHED.lock() {
        if guard
            .as_ref()
            .is_some_and(|(id, p)| id == device_id && *p == port)
        {
            return Ok(());
        }
    }

    let mut guard = daemon()?;
    if guard.is_none() {
        *guard = Some(mdns_sd::ServiceDaemon::new().map_err(|e| format!("mDNS daemon: {e}"))?);
    }
    let daemon = guard.as_ref().expect("daemon just set");

    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let instance = format!("savecloud-{device_id}");
    let mut properties = std::collections::HashMap::new();
    properties.insert("deviceId".to_string(), device_id.to_string());
    properties.insert("userId".to_string(), user_id.to_string());

    let host_ip = primary_lan_ipv4()
        .map(|v4| v4.to_string())
        .unwrap_or_default();

    let info = mdns_sd::ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &format!("{host}.local."),
        &host_ip,
        port,
        properties,
    )
    .map_err(|e| format!("mDNS ServiceInfo: {e}"))?;

    daemon
        .register(info)
        .map_err(|e| format!("mDNS register: {e}"))?;

    if let Ok(mut last) = LAST_PUBLISHED.lock() {
        *last = Some((device_id.to_string(), port));
    }

    log::info!("mDNS publicado: {SERVICE_TYPE} device={device_id} ip={host_ip} port={port}");
    Ok(())
}

pub fn withdraw_lan_service() {
    if let Ok(mut last) = LAST_PUBLISHED.lock() {
        *last = None;
    }
    if let Ok(mut guard) = daemon() {
        if let Some(daemon) = guard.take() {
            let _ = daemon.shutdown();
            log::info!("mDNS retirado");
        }
    }
}
