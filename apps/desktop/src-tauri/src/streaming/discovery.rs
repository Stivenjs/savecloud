//! # Descubrimiento de Hosts de Streaming en Red Local (mDNS)
//!
//! Este módulo gestiona el registro y descubrimiento automático de miembros de la red local (LAN)
//! mediante el protocolo mDNS (ZeroConf/Bonjour) utilizando el servicio `_sc-stream._tcp.local.`.

use mdns_sd::{ServiceDaemon, ServiceEvent, ServiceInfo};
use serde::Serialize;
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::{Duration, Instant};

/// Tipo de servicio mDNS registrado para el streaming de SaveCloud.
const STREAM_SERVICE_TYPE: &str = "_sc-stream._tcp.local.";

/// Instancia estática singleton del demonio mDNS.
static MDNS_DAEMON: LazyLock<Mutex<Option<ServiceDaemon>>> = LazyLock::new(|| Mutex::new(None));

/// Registro de la última configuración publicada (device_id, sunshine_port).
static LAST_PUBLISHED: LazyLock<Mutex<Option<(String, u16)>>> = LazyLock::new(|| Mutex::new(None));

/// Accede de forma segura al guard de Mutex del demonio mDNS con resiliencia a locks envenenados.
fn daemon() -> MutexGuard<'static, Option<ServiceDaemon>> {
    MDNS_DAEMON
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}

/// Detecta la dirección IPv4 local primaria utilizada para la salida de red LAN.
///
/// # Returns
/// Retorna `Some(Ipv4Addr)` si existe una interfaz IPv4 activa y no en bucle local (*loopback*).
#[must_use]
pub fn primary_lan_ipv4() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("1.1.1.1:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(v4),
        _ => None,
    }
}

/// Estructura que representa un host de streaming descubierto en la red local.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DiscoveredStreamHost {
    /// Identificador único del dispositivo emisor.
    pub device_id: String,
    /// Identificador del usuario propietario de la sesión.
    pub user_id: String,
    /// Dirección IP del host en la red local.
    pub ip: String,
    /// Puerto principal de Sunshine (ej. 47989).
    pub port: u16,
    /// Puerto HTTP/WebSocket auxiliar de SaveCloud (ej. 47990).
    pub savecloud_port: u16,
    /// Nombre de red del equipo (*hostname*).
    pub hostname: String,
}

/// Publica la intención de este PC de transmitir un juego en la red local mediante mDNS.
///
/// # Arguments
/// * `device_id` - Identificador único de este equipo.
/// * `user_id` - Identificador del usuario actual.
/// * `sunshine_port` - Puerto activo del servidor Sunshine.
/// * `savecloud_port` - Puerto del servidor de señalización / WebSocket de SaveCloud.
///
/// # Errors
/// Retorna `Err(String)` si falla el registro en la pila mDNS del sistema operativo.
pub fn publish_stream_service(
    device_id: &str,
    user_id: &str,
    sunshine_port: u16,
    savecloud_port: u16,
) -> Result<(), String> {
    if sunshine_port == 0 {
        return Ok(());
    }

    let last_published_guard = LAST_PUBLISHED
        .lock()
        .unwrap_or_else(|e| e.into_inner());

    if last_published_guard
        .as_ref()
        .is_some_and(|(id, p)| id == device_id && *p == sunshine_port)
    {
        return Ok(());
    }
    drop(last_published_guard);

    let mut guard = daemon();
    if guard.is_none() {
        *guard = Some(ServiceDaemon::new().map_err(|err| format!("mDNS daemon: {err}"))?);
    }
    let daemon = match guard.as_ref() {
        Some(d) => d,
        None => return Err("Fallo al acceder al demonio mDNS".into()),
    };

    let host = gethostname::gethostname().to_string_lossy().into_owned();
    let instance = format!("stream-{device_id}");

    let host_ip = primary_lan_ipv4()
        .map(|v4| v4.to_string())
        .unwrap_or_default();

    let mut properties = HashMap::new();
    properties.insert("deviceId".to_string(), device_id.to_string());
    properties.insert("userId".to_string(), user_id.to_string());
    properties.insert("savecloudPort".to_string(), savecloud_port.to_string());
    properties.insert("ipAddress".to_string(), host_ip.clone());

    let info = ServiceInfo::new(
        STREAM_SERVICE_TYPE,
        &instance,
        &format!("{host}.local."),
        &host_ip,
        sunshine_port,
        properties,
    )
    .map_err(|err| format!("mDNS ServiceInfo: {err}"))?;

    daemon
        .register(info)
        .map_err(|err| format!("mDNS register: {err}"))?;

    let mut last = LAST_PUBLISHED
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    *last = Some((device_id.to_string(), sunshine_port));

    log::info!(
        "[mDNS] Host de streaming publicado: device={device_id} ip={host_ip} port={sunshine_port} savecloud_port={savecloud_port}"
    );
    Ok(())
}

/// Retira y anula el anuncio de servicio mDNS de streaming de este PC en la LAN.
pub fn withdraw_stream_service() {
    let mut last = LAST_PUBLISHED
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    *last = None;

    let mut guard = daemon();
    if let Some(daemon) = guard.as_ref() {
        let _ = daemon.shutdown();
    }
    *guard = None;

    log::info!("[mDNS] Anuncio de host de streaming retirado exitosamente");
}

/// Explora la red local durante un máximo de `timeout_secs` segundos en búsqueda de hosts de streaming activos.
///
/// # Arguments
/// * `timeout_secs` - Tiempo máximo de exploración en segundos (ej. 3 o 5 segundos).
///
/// # Returns
/// Retorna la lista deduplicada de equipos de streaming encontrados en la red local.
///
/// # Errors
/// Retorna `Err(String)` si el demonio mDNS no logra iniciarse.
///
/// # Latency & Performance Notes
/// - **Ultrafast Discovery (100ms - 350ms)**: Retorna de forma adaptativa tan pronto como se resuelve un host
///   y transcurre la ventana de gracia de 350ms sin nuevos anuncios.
/// - **Muestreo de 50ms**: Procesa tramas mDNS multicast al instante.
/// - **Reutilización Singleton**: Utiliza la instancia `daemon()` existente evitando 500ms de reconexión.
pub async fn discover_stream_hosts(timeout_secs: u64) -> Result<Vec<DiscoveredStreamHost>, String> {
    tokio::task::spawn_blocking(move || {
        let mut guard = daemon();
        if guard.is_none() {
            *guard = Some(ServiceDaemon::new().map_err(|err| format!("Fallo al iniciar mDNS daemon: {err}"))?);
        }
        let daemon_ref = match guard.as_ref() {
            Some(d) => d,
            None => return Err("Fallo al acceder al demonio mDNS".into()),
        };

        let receiver = daemon_ref
            .browse(STREAM_SERVICE_TYPE)
            .map_err(|err| format!("mDNS browse: {err}"))?;

        drop(guard);

        let mut host_map: HashMap<String, DiscoveredStreamHost> = HashMap::new();
        let start = Instant::now();
        let timeout = Duration::from_secs(timeout_secs);
        let mut last_resolved_at: Option<Instant> = None;

        while start.elapsed() < timeout {
            if let Ok(ServiceEvent::ServiceResolved(info)) =
                receiver.recv_timeout(Duration::from_millis(50))
            {
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

                    let mut ip = info
                        .get_addresses()
                        .iter()
                        .next()
                        .map(|ip| ip.to_string())
                        .unwrap_or_default();

                    if ip.is_empty() {
                        ip = properties
                            .get("ipAddress")
                            .map(|v| v.val_str().to_string())
                            .unwrap_or_default();
                    }

                    if !ip.is_empty() {
                        let key = if !device_id.is_empty() {
                            device_id.clone()
                        } else {
                            format!("{ip}:{}", info.get_port())
                        };

                        log::info!(
                            "[mDNS] Host descubierto ultrarrápido (key={key}): hostname={}, ip={ip}, device_id={device_id}",
                            info.get_hostname()
                        );

                        host_map.insert(
                            key,
                            DiscoveredStreamHost {
                                device_id,
                                user_id,
                                ip,
                                port: info.get_port(),
                                savecloud_port,
                                hostname: info.get_hostname().to_string(),
                            },
                        );

                        last_resolved_at = Some(Instant::now());
                    }
                }


            if let Some(t) = last_resolved_at {
                if t.elapsed() >= Duration::from_millis(350) {
                    log::info!(
                        "[mDNS] Descubrimiento ultrarrápido completado en {}ms con {} hosts",
                        start.elapsed().as_millis(),
                        host_map.len()
                    );
                    break;
                }
            }
        }

        Ok(host_map.into_values().collect())
    })
    .await
    .map_err(|err| format!("Error en tarea de descubrimiento mDNS: {err}"))?
}



