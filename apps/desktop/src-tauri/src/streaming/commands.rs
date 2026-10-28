//! Comandos de Tauri para gestionar el streaming (Host y Cliente).
//!
//! Estos comandos son llamados desde el frontend de React para iniciar
//! sesiones de host, buscar otros jugadores en la red local y conectarse.

use super::discovery::{discover_stream_hosts, withdraw_stream_service, DiscoveredStreamHost};
use super::session::{HostState, StreamingState};
use tauri::{command, AppHandle, Emitter, Manager, State};

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

    state
        .host
        .start(Some(state.session.clone()))
        .await
        .map_err(|e| e.to_string())?;

    // 2. Publicar en mDNS que somos un Host, pasando también el puerto de nuestra API LAN
    super::discovery::publish_stream_service(&device_id, &user_id, 47989, savecloud_port)?;

    // Sunshine recibe un PIN de cuatro dígitos en stdin. SaveCloud usa un código
    // de seis dígitos independiente para autorizar el registro del certificado LAN.
    let sunshine_pin = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        format!("{:04}", rng.gen_range(0..10000))
    };
    let pairing_code = {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        format!("{:06}", rng.gen_range(0..1_000_000))
    };

    if let Err(e) = state.host.provide_pin(&sunshine_pin).await {
        log::warn!("No se pudo proveer PIN al stdin de Sunshine: {}", e);
    }
    crate::peer_lan::server::set_streaming_pairing_code(pairing_code.clone())?;

    *state.session.lock().unwrap() = HostState::Hosting {
        pin: pairing_code.clone(),
        clients: vec![],
    };
    let _ = app.emit("streaming-state-changed", ());

    Ok(pairing_code)
}

/// Conecta este cliente a un Host descubierto en la LAN usando su IP y configuraciones avanzadas de transmisión.
#[expect(
    clippy::too_many_arguments,
    reason = "Comando IPC de Tauri expuesto al frontend con opciones de streaming"
)]
#[tauri::command]
pub async fn streaming_connect_lan(
    ip_address: String,
    mut savecloud_port: u16,
    pairing_code: String,
    mut tls_fingerprint: String,
    width: Option<i32>,
    height: Option<i32>,
    fps: Option<i32>,
    bitrate_kbps: Option<i32>,
    codec: Option<String>,
    enable_vsync: Option<bool>,
    refresh_rate_x100: Option<i32>,
    state: tauri::State<'_, StreamingState>,
    app: tauri::AppHandle,
) -> Result<super::client::ConnectResult, String> {
    let is_loopback = ip_address == "127.0.0.1" || ip_address == "localhost" || ip_address == "::1";
    super::set_mirror_mode(is_loopback);

    if ip_address == "127.0.0.1" && savecloud_port == 0 {
        savecloud_port =
            crate::peer_lan::server::ensure_lan_http_server(Some(state.host.clone())).await?;
        state
            .host
            .start(Some(state.session.clone()))
            .await
            .map_err(|e| e.to_string())?;
        tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
    }
    if tls_fingerprint.trim().is_empty() && is_loopback {
        tls_fingerprint = crate::peer_lan::server::lan_tls_fingerprint()
            .ok_or_else(|| "No se pudo obtener la huella TLS del servidor local".to_string())?;
    }

    let video_format = match codec.as_deref() {
        Some("h265") | Some("hevc") => super::bindings::VIDEO_FORMAT_H265,
        Some("av1") => super::bindings::VIDEO_FORMAT_AV1_MAIN8,
        _ => {
            super::bindings::VIDEO_FORMAT_H265
                | super::bindings::VIDEO_FORMAT_H264
                | super::bindings::VIDEO_FORMAT_AV1_MAIN8
        }
    };

    let target_fps = fps.unwrap_or(60);

    let stream_options = super::client::StreamOptions {
        width: width.unwrap_or(1920),
        height: height.unwrap_or(1080),
        fps: target_fps,
        bitrate_kbps: bitrate_kbps.unwrap_or(50_000),
        video_format,
        enable_vsync: enable_vsync.unwrap_or(true),
        refresh_rate_x100: refresh_rate_x100.unwrap_or(target_fps * 100),
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

    let connect_res = state
        .client
        .connect_lan(
            &ip_address,
            savecloud_port,
            &pairing_code,
            &tls_fingerprint,
            &stream_options,
        )
        .await
        .map_err(|e| {
            super::set_mirror_mode(false);
            e.to_string()
        })?;

    if let Err(e) = state
        .client
        .start_stream(&ip_address, &stream_options)
        .await
    {
        state.client.disconnect();
        super::set_mirror_mode(false);
        return Err(e.to_string());
    }

    *state.session.lock().unwrap() = HostState::Playing {
        host_ip: ip_address.clone(),
        ws_port: connect_res.ws_port,
    };
    let _ = app.emit("streaming-state-changed", ());

    Ok(connect_res)
}

/// Detiene cualquier sesión activa de streaming (como Host o Cliente).
#[command]
pub async fn streaming_stop(
    state: State<'_, StreamingState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("Comando: Deteniendo servicios de streaming");

    state.client.disconnect();
    super::set_mirror_mode(false);

    state.host.stop().await.map_err(|e| e.to_string())?;
    crate::peer_lan::server::clear_streaming_pairing_code();
    super::bindings::reset_bindings_state();
    super::input_relay::reset_input_relay_state();
    withdraw_stream_service();

    *state.session.lock().unwrap() = HostState::Idle;
    let _ = app.emit("streaming-state-changed", ());

    Ok(())
}

/// Cancela la sesión activa de streaming en Sunshine Host (desconecta al cliente) sin apagar el host.
#[command]
pub async fn streaming_cancel_active_session(
    state: State<'_, StreamingState>,
    app: AppHandle,
) -> Result<(), String> {
    log::info!("Comando: Cancelando sesión de cliente activo en Sunshine Host");

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let _ = client.get("https://127.0.0.1:47989/cancel").send().await;
    let _ = client.get("https://127.0.0.1:47984/cancel").send().await;
    let _ = client.get("https://localhost:47989/cancel").send().await;
    let _ = client.get("https://localhost:47984/cancel").send().await;

    if let Ok(mut session) = state.session.lock() {
        if let HostState::Hosting {
            ref mut clients, ..
        } = *session
        {
            clients.clear();
        }
    }
    let _ = app.emit("streaming-state-changed", ());

    Ok(())
}

/// Obtiene el estado actual del motor de streaming.
#[command]
pub fn streaming_get_state(state: State<'_, StreamingState>) -> Result<HostState, String> {
    let session = state.session.lock().unwrap();
    Ok(session.clone())
}

/// Retorna la lista de todos los dispositivos de salida de sonido físicos disponibles.
#[command]
pub fn list_audio_output_devices() -> Result<Vec<super::audio::AudioOutputDeviceItem>, String> {
    Ok(super::audio::enumerate_audio_output_devices())
}

/// Guarda la preferencia de dispositivo de salida de sonido en settings.json.
#[command]
pub fn set_audio_output_device(device_name: Option<String>) -> Result<(), String> {
    let mut settings = crate::config::load_settings();
    settings.audio_output_device = device_name.clone();
    crate::config::save_settings(&settings).map_err(|e| e.to_string())?;
    log::info!(
        "[Audio] Dispositivo de salida configurado a: {:?}",
        device_name
    );
    Ok(())
}

/// Obtiene el dispositivo de salida de sonido preferido guardado.
#[command]
pub fn get_audio_output_device() -> Result<Option<String>, String> {
    let settings = crate::config::load_settings();
    Ok(settings.audio_output_device)
}

/// Libera inmediatamente todas las teclas de teclado y ratón pegadas en el host remoto.
#[command]
pub fn streaming_release_inputs() -> Result<(), String> {
    super::input_relay::release_all_keyboard_keys();
    #[cfg(target_os = "windows")]
    super::input_listener::release_all_active_keys();
    log::info!("Comando: Liberación forzada de teclas ejecutada");
    Ok(())
}

/// Alterna el estado de Pantalla Completa de la ventana de streaming.
#[command]
pub async fn streaming_toggle_fullscreen(app: AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("streaming-window") {
        let is_fullscreen = window.is_fullscreen().map_err(|e| e.to_string())?;
        let next_state = !is_fullscreen;
        window
            .set_fullscreen(next_state)
            .map_err(|e| e.to_string())?;
        log::info!("Comando: Pantalla completa alternada a: {}", next_state);
        Ok(next_state)
    } else {
        Err("Ventana de streaming no encontrada".into())
    }
}
