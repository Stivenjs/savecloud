//! Comandos de Tauri para gestionar el streaming (Host y Cliente).
//!
//! Estos comandos son llamados desde el frontend de React para iniciar
//! sesiones de host, buscar otros jugadores en la red local y conectarse.

use super::discovery::{
    discover_stream_hosts, publish_stream_service, withdraw_stream_service, DiscoveredStreamHost,
};
use super::session::{HostState, StreamingState};
use tauri::{command, AppHandle, State};

/// Busca otros hosts de SaveCloud en la red local que estén emitiendo un juego.
#[command]
pub async fn streaming_discover_lan(
    timeout_secs: u64,
) -> Result<Vec<DiscoveredStreamHost>, String> {
    log::info!(
        "Comando: Buscando hosts de streaming LAN (timeout: {}s)",
        timeout_secs
    );
    discover_stream_hosts(timeout_secs).await
}

/// Inicia la sesión de Host (Sunshine) en este dispositivo.
#[command]
pub async fn streaming_start_host(
    state: State<'_, StreamingState>,
    _app: AppHandle,
    device_id: String,
    user_id: String,
) -> Result<String, String> {
    log::info!("Comando: Iniciando sesión de Host de streaming");

    state.host.start().await?;

    publish_stream_service(&device_id, &user_id, 47989)?;

    // 3. TODO: Obtener el PIN de la API de Sunshine (/api/pin)
    // Por ahora simulamos un PIN generado aleatoriamente
    let simulated_pin = "1234".to_string();

    *state.session.lock().unwrap() = HostState::Hosting {
        pin: simulated_pin.clone(),
        clients: vec![],
    };

    Ok(simulated_pin)
}

/// Conecta este cliente a un Host descubierto en la LAN usando su IP y PIN.
#[command]
pub async fn streaming_connect_lan(
    state: State<'_, StreamingState>,
    ip_address: String,
    pin: String,
) -> Result<(), String> {
    log::info!(
        "Comando: Conectando a LAN Host {} con PIN {}",
        ip_address,
        pin
    );

    // TODO: Usar moonlight-common-c para hacer el pairing usando el PIN

    // Conectar el cliente
    state
        .client
        .connect_lan(&ip_address, 1920, 1080, 60)
        .await?;

    // Actualizar estado
    *state.session.lock().unwrap() = HostState::Playing {
        host_ip: ip_address,
    };

    Ok(())
}

/// Detiene cualquier sesión activa de streaming (como Host o Cliente).
#[command]
pub async fn streaming_stop(state: State<'_, StreamingState>) -> Result<(), String> {
    log::info!("Comando: Deteniendo servicios de streaming");

    state.client.disconnect();

    state.host.stop().await?;
    withdraw_stream_service();

    *state.session.lock().unwrap() = HostState::Idle;

    Ok(())
}

/// Obtiene el estado actual del motor de streaming.
#[command]
pub fn streaming_get_state(state: State<'_, StreamingState>) -> Result<HostState, String> {
    let session = state.session.lock().unwrap();
    Ok(session.clone())
}
