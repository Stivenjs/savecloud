//! Registro mDNS persistente (`_savecloud._tcp`).

use std::sync::Mutex;

use once_cell::sync::Lazy;

const SERVICE_TYPE: &str = "_savecloud._tcp.local.";

static MDNS_DAEMON: Lazy<Mutex<Option<mdns_sd::ServiceDaemon>>> =
    Lazy::new(|| Mutex::new(None));

fn daemon() -> Result<std::sync::MutexGuard<'static, Option<mdns_sd::ServiceDaemon>>, String> {
    MDNS_DAEMON
        .lock()
        .map_err(|e| format!("mDNS lock: {e}"))
}

/// Publica (o actualiza) este dispositivo en la LAN.
pub fn publish_lan_service(device_id: &str, user_id: &str, port: u16) -> Result<(), String> {
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

    let info = mdns_sd::ServiceInfo::new(
        SERVICE_TYPE,
        &instance,
        &format!("{host}.local."),
        "",
        port,
        properties,
    )
    .map_err(|e| format!("mDNS ServiceInfo: {e}"))?;

    daemon
        .register(info)
        .map_err(|e| format!("mDNS register: {e}"))?;
    Ok(())
}

/// Retira el anuncio mDNS de este dispositivo.
pub fn withdraw_lan_service() {
    if let Ok(mut guard) = daemon() {
        if let Some(daemon) = guard.take() {
            let _ = daemon.shutdown();
        }
    }
}
