//! Comandos de Tauri para gestionar el streaming (Host y Cliente).
//!
//! Estos comandos son llamados desde el frontend de React para iniciar
//! sesiones de host, buscar otros jugadores en la red local y conectarse.

use super::discovery::{discover_stream_hosts, withdraw_stream_service, DiscoveredStreamHost};
use super::session::{HostState, StreamingState};
use tauri::{command, AppHandle, Emitter, State};

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
    app: AppHandle,
    device_id: String,
    user_id: String,
) -> Result<String, String> {
    log::info!("Comando: Iniciando sesión de Host de streaming");

    let savecloud_port =
        crate::peer_lan::server::ensure_lan_http_server(Some(state.host.clone())).await?;

    state.host.start().await.map_err(|e| e.to_string())?;

    // 2. Publicar en mDNS que somos un Host, pasando también el puerto de nuestra API LAN
    super::discovery::publish_stream_service(&device_id, &user_id, 47989, savecloud_port)?;

    // 3. Generar un PIN aleatorio de 4 dígitos para el Host
    let simulated_pin = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        format!("{:04}", rng.gen_range(0..10000))
    };

    // 4. Escribir el PIN en el stdin de Sunshine para que lo valide automáticamente
    // cuando el cliente haga la petición de emparejamiento con este mismo PIN.
    if let Err(e) = state.host.provide_pin(&simulated_pin).await {
        log::warn!("No se pudo proveer PIN al stdin de Sunshine: {}", e);
    }

    *state.session.lock().unwrap() = HostState::Hosting {
        pin: simulated_pin.clone(),
        clients: vec![],
    };
    let _ = app.emit("streaming-state-changed", ());

    Ok(simulated_pin)
}

/// Conecta este cliente a un Host descubierto en la LAN usando su IP y configuraciones avanzadas de transmisión.
#[tauri::command]
pub async fn streaming_connect_lan(
    ip_address: String,
    mut savecloud_port: u16,
    width: Option<i32>,
    height: Option<i32>,
    fps: Option<i32>,
    bitrate_kbps: Option<i32>,
    codec: Option<String>,
    state: tauri::State<'_, StreamingState>,
    app: tauri::AppHandle,
) -> Result<u16, String> {
    if ip_address == "127.0.0.1" && savecloud_port == 0 {
        savecloud_port =
            crate::peer_lan::server::ensure_lan_http_server(Some(state.host.clone())).await?;
        state.host.start().await.map_err(|e| e.to_string())?;
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
    }

    let video_format = match codec.as_deref() {
        Some("h265") | Some("hevc") => super::bindings::VIDEO_FORMAT_H265,
        Some("av1") => super::bindings::VIDEO_FORMAT_AV1_MAIN8,
        _ => super::bindings::VIDEO_FORMAT_H264,
    };

    let stream_options = super::client::StreamOptions {
        width: width.unwrap_or(1920),
        height: height.unwrap_or(1080),
        fps: fps.unwrap_or(60),
        bitrate_kbps: bitrate_kbps.unwrap_or(50_000),
        video_format,
    };

    log::info!(
        "Comando: Conectando a host en {} (SaveCloud: {}) con opciones: {}x{}@{}fps, {} kbps, codec: {}",
        ip_address,
        savecloud_port,
        stream_options.width,
        stream_options.height,
        stream_options.fps,
        stream_options.bitrate_kbps,
        stream_options.video_format
    );

    let ws_port = state
        .client
        .connect_lan(&ip_address, savecloud_port, &stream_options)
        .await
        .map_err(|e| e.to_string())?;

    if let Err(e) = state.client.start_stream(&ip_address, &stream_options).await {
        state.client.disconnect();
        return Err(e.to_string());
    }

    *state.session.lock().unwrap() = HostState::Playing {
        host_ip: ip_address.clone(),
        ws_port,
    };
    let _ = app.emit("streaming-state-changed", ());

    Ok(ws_port)
}

/// Detiene cualquier sesión activa de streaming (como Host o Cliente).
#[command]
pub async fn streaming_stop(
    state: State<'_, StreamingState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("Comando: Deteniendo servicios de streaming");

    state.client.disconnect();

    state.host.stop().await.map_err(|e| e.to_string())?;
    withdraw_stream_service();

    *state.session.lock().unwrap() = HostState::Idle;
    let _ = app.emit("streaming-state-changed", ());

    Ok(())
}

/// Obtiene el estado actual del motor de streaming.
#[command]
pub fn streaming_get_state(state: State<'_, StreamingState>) -> Result<HostState, String> {
    let session = state.session.lock().unwrap();
    Ok(session.clone())
}
