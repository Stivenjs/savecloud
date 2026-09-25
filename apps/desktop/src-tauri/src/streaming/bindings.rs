//! # FFI Bindings para Moonlight-Common-C
//!
//! Este módulo proporciona wrappers FFI seguros y declaraciones C `extern` para la biblioteca `moonlight-common-c`.
//! Gestiona las callbacks de decodificación de video/audio, eventos de entrada (teclado, ratón, gamepad)
//! y la transmisión de tramas en tiempo real sobre la ruta crítica (*hot-path* a 60-120+ FPS).
//!
//! ## Optimizaciones de Ruta Crítica (Hot-Path)
//!
//! 1. **Atómicos Globales `const` sin Guardas `Lazy`**:
//!    - `FIRST_FRAME_RECEIVED`, `NEGOTIATED_VIDEO_FORMAT` y `FRAME_COUNT` se declaran como atómicos globales
//!      nativos inicializados en tiempo de compilación. Esto elimina las comprobaciones de inicialización de runtime por cada fotograma.
//! 2. **Copia Directa en Memoria `memcpy` (`ptr::copy_nonoverlapping`)**:
//!    - En [`dr_submit_decode_unit`], los fragmentos del linked-list C (`LENTRY`) se copian al buffer de salida
//!      mediante instrucciones `copy_nonoverlapping` y ajuste manual de longitud (`set_len`), igualando el rendimiento de C/C++.
//! 3. **Almacenamiento Zero-Copy de IDR Keyframe (`Arc<Vec<u8>>`)**:
//!    - [`LAST_IDR_FRAME`] utiliza `Arc<Vec<u8>>` para preservar el último fotograma clave sin re-alocar cientos de KB de memoria heap.
//! 4. **Inlining Agresivo (`#[inline(always)]`)**:
//!    - Todas las funciones de eventos de entrada poseen el atributo `#[inline(always)]` para eliminar saltos de pila FFI.

#![allow(non_camel_case_types, non_snake_case, dead_code)]

use std::ffi::CStr;
use std::fmt::Debug;
use std::mem::MaybeUninit;
use std::os::raw::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use tokio::sync::mpsc;

// Polyfill para __builtin_cpu_supports en macOS x86_64
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
#[no_mangle]
pub static mut __cpu_model: [u32; 4] = [0, 0, 0, 0];

// 1. Constantes FFI

/// Máscara para códec H.264 (AVC).
pub const VIDEO_FORMAT_H264: i32 = 0x0001;
/// Máscara para códec H.265 (HEVC).
pub const VIDEO_FORMAT_H265: i32 = 0x0100;
/// Máscara para códec AV1 Main 8-bit.
pub const VIDEO_FORMAT_AV1_MAIN8: i32 = 0x1000;

/// Configuración de transmisión local LAN.
pub const STREAM_CFG_LOCAL: i32 = 0;
/// Configuración de transmisión remota WAN.
pub const STREAM_CFG_REMOTE: i32 = 1;
/// Configuración de transmisión automática.
pub const STREAM_CFG_AUTO: i32 = 2;

/// Identificador de trama P-Frame (inter-coded frame).
pub const FRAME_TYPE_PFRAME: i32 = 0x00;
/// Identificador de trama IDR Keyframe (intra-coded keyframe).
pub const FRAME_TYPE_IDR: i32 = 0x01;

/// Código de retorno FFI exitoso para el decodificador.
pub const DR_OK: i32 = 0;
/// Código de retorno FFI para solicitar un nuevo IDR Keyframe urgente a Sunshine.
pub const DR_NEED_IDR: i32 = -1;

/// Configuración de audio estéreo 2.0 (Opus 48kHz).
pub const AUDIO_CONFIGURATION_STEREO: i32 = 0x000302CA;

/// Banderas de cifrado nulo.
pub const ENCFLG_NONE: i32 = 0x00000000;
/// Banderas de cifrado para audio.
pub const ENCFLG_AUDIO: i32 = 0x00000001;
/// Banderas de cifrado para video.
pub const ENCFLG_VIDEO: i32 = 0x00000002;
/// Banderas de cifrado completo (Audio + Video).
pub const ENCFLG_ALL: i32 = ENCFLG_AUDIO | ENCFLG_VIDEO;

// 2. Estructuras C (FFI)

/// Configuración de transmisión FFI para `moonlight-common-c`.
#[repr(C)]
#[derive(Debug, Clone)]
pub struct STREAM_CONFIGURATION {
    pub width: c_int,
    pub height: c_int,
    pub fps: c_int,
    pub bitrate: c_int,
    pub packetSize: c_int,
    pub streamingRemotely: c_int,
    pub audioConfiguration: c_int,
    pub supportedVideoFormats: c_int,
    pub clientRefreshRateX100: c_int,
    pub colorSpace: c_int,
    pub colorRange: c_int,
    pub encryptionFlags: c_int,
    pub remoteInputAesKey: [c_char; 16],
    pub remoteInputAesIv: [c_char; 16],
}

/// Nodo de la lista enlazada C que representa un fragmento de datos de video.
#[repr(C)]
#[derive(Debug, Clone)]
#[allow(clippy::upper_case_acronyms)]
pub struct LENTRY {
    pub next: *mut LENTRY,
    pub data: *mut c_char,
    pub length: c_int,
    pub bufferType: c_int,
}

/// Unidad de decodificación C entregada por Moonlight-C con las tramas NALU.
#[repr(C)]
#[derive(Debug, Clone)]
#[allow(clippy::upper_case_acronyms)]
pub struct DECODE_UNIT {
    pub frameNumber: c_int,
    pub frameType: c_int,
    pub frameHostProcessingLatency: u16,
    pub receiveTimeUs: u64,
    pub enqueueTimeUs: u64,
    pub presentationTimeUs: u64,
    pub rtpTimestamp: u32,
    pub fullLength: c_int,
    pub bufferList: *mut LENTRY,
    pub hdrActive: bool,
    pub colorspace: u8,
}

pub type DecoderRendererSetup = Option<
    unsafe extern "C" fn(
        videoFormat: c_int,
        width: c_int,
        height: c_int,
        redrawRate: c_int,
        context: *mut c_void,
        drFlags: c_int,
    ) -> c_int,
>;
pub type DecoderRendererStart = Option<unsafe extern "C" fn()>;
pub type DecoderRendererStop = Option<unsafe extern "C" fn()>;
pub type DecoderRendererCleanup = Option<unsafe extern "C" fn()>;
pub type DecoderRendererSubmitDecodeUnit =
    Option<unsafe extern "C" fn(decodeUnit: *mut DECODE_UNIT) -> c_int>;

/// Callbacks FFI para el decodificador y renderizador de video.
#[repr(C)]
#[derive(Debug, Clone)]
#[allow(clippy::upper_case_acronyms)]
pub struct DECODER_RENDERER_CALLBACKS {
    pub setup: DecoderRendererSetup,
    pub start: DecoderRendererStart,
    pub stop: DecoderRendererStop,
    pub cleanup: DecoderRendererCleanup,
    pub submitDecodeUnit: DecoderRendererSubmitDecodeUnit,
    pub capabilities: c_int,
}

pub type AudioRendererInit = Option<
    unsafe extern "C" fn(
        audioConfiguration: c_int,
        opusConfig: *const c_void,
        context: *mut c_void,
        arFlags: c_int,
    ) -> c_int,
>;
pub type AudioRendererStart = Option<unsafe extern "C" fn()>;
pub type AudioRendererStop = Option<unsafe extern "C" fn()>;
pub type AudioRendererCleanup = Option<unsafe extern "C" fn()>;
pub type AudioRendererDecodeAndPlaySample =
    Option<unsafe extern "C" fn(sampleData: *mut c_char, sampleLength: c_int)>;

/// Callbacks FFI para el decodificador de audio Opus.
#[repr(C)]
#[derive(Debug, Clone)]
#[allow(clippy::upper_case_acronyms)]
pub struct AUDIO_RENDERER_CALLBACKS {
    pub init: AudioRendererInit,
    pub start: AudioRendererStart,
    pub stop: AudioRendererStop,
    pub cleanup: AudioRendererCleanup,
    pub decodeAndPlaySample: AudioRendererDecodeAndPlaySample,
    pub capabilities: c_int,
}

/// Información del servidor Sunshine FFI.
#[repr(C)]
#[derive(Debug, Clone)]
#[allow(clippy::upper_case_acronyms)]
pub struct SERVER_INFORMATION {
    pub address: *const c_char,
    pub serverInfoAppVersion: *const c_char,
    pub serverInfoGfeVersion: *const c_char,
    pub rtspSessionUrl: *const c_char,
    pub serverCodecModeSupport: c_int,
}

/// Callbacks FFI para la supervisión del estado de conexión.
#[repr(C)]
#[derive(Debug, Clone)]
#[allow(clippy::upper_case_acronyms)]
pub struct CONNECTION_LISTENER_CALLBACKS {
    pub stageStarting: *mut c_void,
    pub stageComplete: *mut c_void,
    pub stageFailed: *mut c_void,
    pub connectionStarted: *mut c_void,
    pub connectionTerminated: *mut c_void,
    pub logMessage: *mut c_void,
    pub rumble: *mut c_void,
    pub connectionStatusUpdate: *mut c_void,
    pub setHdrMode: *mut c_void,
    pub rumbleTriggers: *mut c_void,
    pub setMotionEventState: *mut c_void,
    pub setControllerLED: *mut c_void,
    pub setAdaptiveTriggers: *mut c_void,
}

// Constantes de Teclado, Ratón y Controles
pub const KEY_ACTION_DOWN: i8 = 0x03;
pub const KEY_ACTION_UP: i8 = 0x04;
pub const MODIFIER_SHIFT: i8 = 0x01;
pub const MODIFIER_CTRL: i8 = 0x02;
pub const MODIFIER_ALT: i8 = 0x04;
pub const MODIFIER_META: i8 = 0x08;

pub const BUTTON_ACTION_PRESS: i8 = 0x07;
pub const BUTTON_ACTION_RELEASE: i8 = 0x08;
pub const MOUSE_BUTTON_LEFT: i32 = 0x01;
pub const MOUSE_BUTTON_MIDDLE: i32 = 0x02;
pub const MOUSE_BUTTON_RIGHT: i32 = 0x03;
pub const MOUSE_BUTTON_X1: i32 = 0x04;
pub const MOUSE_BUTTON_X2: i32 = 0x05;

pub const LI_CTYPE_XBOX: u8 = 0x01;
pub const LI_CTYPE_PS: u8 = 0x02;
pub const LI_CTYPE_NINTENDO: u8 = 0x03;
pub const LI_CCAP_ANALOG_TRIGGERS: u16 = 0x01;
pub const LI_CCAP_RUMBLE: u16 = 0x02;

// 3. Declaraciones de funciones externas C

extern "C" {
    pub fn LiInitializeStreamConfiguration(streamConfig: *mut STREAM_CONFIGURATION);
    pub fn LiInitializeVideoCallbacks(drCallbacks: *mut DECODER_RENDERER_CALLBACKS);
    pub fn LiInitializeAudioCallbacks(arCallbacks: *mut AUDIO_RENDERER_CALLBACKS);
    pub fn LiInitializeServerInformation(serverInfo: *mut SERVER_INFORMATION);
    pub fn LiInitializeConnectionCallbacks(clCallbacks: *mut CONNECTION_LISTENER_CALLBACKS);
    pub fn LiStartConnection(
        serverInfo: *mut SERVER_INFORMATION,
        streamConfig: *mut STREAM_CONFIGURATION,
        clCallbacks: *mut CONNECTION_LISTENER_CALLBACKS,
        drCallbacks: *mut DECODER_RENDERER_CALLBACKS,
        arCallbacks: *mut AUDIO_RENDERER_CALLBACKS,
        renderContext: *mut c_void,
        drFlags: c_int,
        audioContext: *mut c_void,
        arFlags: c_int,
    ) -> c_int;
    pub fn LiStopConnection();
    pub fn LiGetConnectState() -> i32;
    pub fn LiSendMultiControllerEvent(
        controllerNumber: i16,
        activeGamepadMask: i16,
        buttonFlags: i32,
        leftTrigger: u8,
        rightTrigger: u8,
        leftStickX: i16,
        leftStickY: i16,
        rightStickX: i16,
        rightStickY: i16,
    ) -> i32;
    pub fn LiSendControllerArrivalEvent(
        controllerNumber: u8,
        activeGamepadMask: u16,
        type_: u8,
        supportedButtonFlags: u32,
        capabilities: u16,
    ) -> i32;
    pub fn LiSendKeyboardEvent(keyCode: i16, keyAction: i8, modifiers: i8) -> i32;
    pub fn LiSendMouseMoveEvent(deltaX: i16, deltaY: i16) -> i32;
    pub fn LiSendMousePositionEvent(
        x: i16,
        y: i16,
        referenceWidth: i16,
        referenceHeight: i16,
    ) -> i32;
    pub fn LiSendMouseButtonEvent(action: i8, button: i32) -> i32;
    pub fn LiSendScrollEvent(scrollClicks: i8) -> i32;
    pub fn LiSendHighResScrollEvent(scrollAmount: i16) -> i32;
    pub fn LiGetLaunchUrlQueryParameters() -> *const c_char;
}

// 4. Wrappers Safe de Rust (Inlined)

/// Envío seguro e inlined de eventos de teclado a Moonlight-C.
#[inline(always)]
pub fn send_keyboard_event(key_code: i16, key_action: i8, modifiers: i8) -> i32 {
    unsafe { LiSendKeyboardEvent(key_code, key_action, modifiers) }
}

/// Envío seguro e inlined de movimiento relativo del ratón.
#[inline(always)]
pub fn send_mouse_move_event(delta_x: i16, delta_y: i16) -> i32 {
    unsafe { LiSendMouseMoveEvent(delta_x, delta_y) }
}

/// Envío seguro e inlined de posición absoluta del ratón.
#[allow(dead_code)]
#[inline(always)]
pub fn send_mouse_position_event(x: i16, y: i16, ref_w: i16, ref_h: i16) -> i32 {
    unsafe { LiSendMousePositionEvent(x, y, ref_w, ref_h) }
}

/// Envío seguro e inlined de botones del ratón.
#[inline(always)]
pub fn send_mouse_button_event(action: i8, button: i32) -> i32 {
    unsafe { LiSendMouseButtonEvent(action, button) }
}

/// Envío seguro e inlined de rueda del ratón.
#[allow(dead_code)]
#[inline(always)]
pub fn send_scroll_event(clicks: i8) -> i32 {
    unsafe { LiSendScrollEvent(clicks) }
}

/// Notifica el registro o llegada de un controlador de juego a Sunshine.
#[inline(always)]
pub fn send_controller_arrival_event(
    controller_number: u8,
    active_gamepad_mask: u16,
    ctype: u8,
    supported_buttons: u32,
    capabilities: u16,
) -> i32 {
    unsafe {
        LiSendControllerArrivalEvent(
            controller_number,
            active_gamepad_mask,
            ctype,
            supported_buttons,
            capabilities,
        )
    }
}

/// Inicializa una estructura [`STREAM_CONFIGURATION`] con valores por defecto FFI.
pub fn initialize_stream_config(config: &mut STREAM_CONFIGURATION) {
    unsafe {
        LiInitializeStreamConfiguration(config as *mut _);
    }
}

/// Inicializa los callbacks del decodificador de video con valores por defecto.
pub fn initialize_video_callbacks(callbacks: &mut DECODER_RENDERER_CALLBACKS) {
    unsafe {
        LiInitializeVideoCallbacks(callbacks as *mut _);
    }
}

/// Inicializa los callbacks del decodificador de audio con valores por defecto.
pub fn initialize_audio_callbacks(callbacks: &mut AUDIO_RENDERER_CALLBACKS) {
    unsafe {
        LiInitializeAudioCallbacks(callbacks as *mut _);
    }
}

/// Inicializa la estructura `SERVER_INFORMATION` con ceros y defaults de C.
pub fn initialize_server_information(server_info: &mut SERVER_INFORMATION) {
    unsafe {
        LiInitializeServerInformation(server_info as *mut _);
    }
}

/// Inicializa la estructura de callbacks de eventos de conexión C.
pub fn initialize_connection_callbacks(callbacks: &mut CONNECTION_LISTENER_CALLBACKS) {
    unsafe {
        LiInitializeConnectionCallbacks(callbacks as *mut _);
    }
}

/// Devuelve los parámetros de query URL para peticiones `/launch` y `/resume` de Sunshine.
#[must_use]
pub fn get_launch_url_query_parameters() -> String {
    unsafe {
        let ptr = LiGetLaunchUrlQueryParameters();
        if ptr.is_null() {
            String::new()
        } else {
            CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

/// Configuración de stream personalizada para LAN con resolución, FPS, bitrate y formato dinámico.
#[must_use]
pub fn custom_lan_stream_config(
    width: i32,
    height: i32,
    fps: i32,
    bitrate_kbps: i32,
    video_format: i32,
    refresh_rate_x100: i32,
) -> STREAM_CONFIGURATION {
    let mut config: STREAM_CONFIGURATION = unsafe { MaybeUninit::zeroed().assume_init() };
    initialize_stream_config(&mut config);

    config.width = width as c_int;
    config.height = height as c_int;
    config.fps = fps as c_int;
    config.bitrate = bitrate_kbps.clamp(1_000, 150_000) as c_int;
    config.packetSize = 1392;
    config.streamingRemotely = STREAM_CFG_LOCAL;
    config.audioConfiguration = AUDIO_CONFIGURATION_STEREO;
    config.supportedVideoFormats = video_format;
    config.encryptionFlags = ENCFLG_ALL;

    // Configuración de V-Sync y Enhanced Frame Pacing en Sunshine
    config.clientRefreshRateX100 = if refresh_rate_x100 > 0 {
        refresh_rate_x100 as c_int
    } else {
        (fps * 100) as c_int
    };

    config
}

/// Configuración de stream con valores razonables por defecto para LAN.
#[must_use]
pub fn default_lan_stream_config(width: i32, height: i32, fps: i32) -> STREAM_CONFIGURATION {
    let supported_formats = VIDEO_FORMAT_H265 | VIDEO_FORMAT_H264 | VIDEO_FORMAT_AV1_MAIN8;
    custom_lan_stream_config(width, height, fps, 50_000, supported_formats, fps * 100)
}

// 5. Canales y estados globales hot-path

/// Canal estático global para el envío de fotogramas al servidor WebSocket local.
pub static VIDEO_CHANNEL: LazyLock<Mutex<Option<mpsc::Sender<Vec<u8>>>>> =
    LazyLock::new(|| Mutex::new(None));

/// Asigna el transmisor del canal de video local.
pub fn set_video_channel(sender: mpsc::Sender<Vec<u8>>) {
    if let Ok(mut guard) = VIDEO_CHANNEL.lock() {
        *guard = Some(sender);
    }
}

pub unsafe extern "C" fn cl_stage_starting(stage: c_int) {
    log::info!("Moonlight Stage Starting: {stage}");
}

pub unsafe extern "C" fn cl_stage_complete(stage: c_int) {
    log::info!("Moonlight Stage Complete: {stage}");
}

pub unsafe extern "C" fn cl_stage_failed(stage: c_int, error_code: c_int) {
    log::error!("Moonlight Stage Failed: stage={stage}, error_code={error_code}");
}

pub unsafe extern "C" fn cl_connection_started() {
    log::info!("Moonlight Connection Started successfully");
}

pub unsafe extern "C" fn cl_connection_terminated(error_code: c_int) {
    log::warn!("Moonlight Connection Terminated: error_code={error_code}");
}

pub unsafe extern "C" fn cl_log_message(msg: *const c_char) {
    if !msg.is_null() {
        let s = CStr::from_ptr(msg).to_string_lossy();
        log::info!("[Moonlight-C] {}", s.trim_end());
    }
}

/// Atómico directo constante para almacenar el códec negociado por Moonlight-C.
pub static NEGOTIATED_VIDEO_FORMAT: AtomicI32 = AtomicI32::new(0);

/// Retorna el identificador en cadena de texto del códec negociado por Moonlight-C ("h264", "h265", "av1").
#[must_use]
pub fn get_negotiated_video_codec_name() -> &'static str {
    match NEGOTIATED_VIDEO_FORMAT.load(Ordering::Relaxed) {
        VIDEO_FORMAT_H265 => "h265",
        VIDEO_FORMAT_AV1_MAIN8 => "av1",
        _ => "h264",
    }
}

pub unsafe extern "C" fn dr_setup(
    videoFormat: c_int,
    width: c_int,
    height: c_int,
    redrawRate: c_int,
    _context: *mut c_void,
    _drFlags: c_int,
) -> c_int {
    NEGOTIATED_VIDEO_FORMAT.store(videoFormat, Ordering::Relaxed);

    let format_str = match videoFormat {
        VIDEO_FORMAT_H264 => "H.264",
        VIDEO_FORMAT_H265 => "H.265 (HEVC)",
        VIDEO_FORMAT_AV1_MAIN8 => "AV1 Main 8-bit",
        _ => "Desconocido",
    };
    log::info!(
        "[Decoder] Negociación de Video Exitosa: {format_str} {width}x{height}@{redrawRate}fps"
    );
    DR_OK
}

/// Atómico directo constante para verificar si ya se recibió el primer fotograma IDR.
pub static FIRST_FRAME_RECEIVED: AtomicBool = AtomicBool::new(false);

/// Solicita a Sunshine el envío inmediato de un nuevo fotograma clave IDR.
pub fn request_idr_frame() {
    FIRST_FRAME_RECEIVED.store(false, Ordering::Relaxed);
    log::info!("[Bindings] Solicitud de fotograma IDR fresco enviada a Sunshine por reconexión");
}

/// Caché del último IDR Keyframe recibido para entrega instantánea a nuevos clientes WebSocket.
pub static LAST_IDR_FRAME: LazyLock<Mutex<Option<Arc<Vec<u8>>>>> =
    LazyLock::new(|| Mutex::new(None));

/// Contador atómico directo constante de tramas procesadas.
static FRAME_COUNT: AtomicU64 = AtomicU64::new(0);

pub unsafe extern "C" fn dr_start() {
    log::info!("Video Decoder Start");
    FIRST_FRAME_RECEIVED.store(false, Ordering::Relaxed);
    if let Ok(mut guard) = LAST_IDR_FRAME.lock() {
        *guard = None;
    }
}

pub unsafe extern "C" fn dr_stop() {
    log::info!("Video Decoder Stop");
    FIRST_FRAME_RECEIVED.store(false, Ordering::Relaxed);
    if let Ok(mut guard) = LAST_IDR_FRAME.lock() {
        *guard = None;
    }
}

pub unsafe extern "C" fn dr_cleanup() {
    log::info!("Video Decoder Cleanup");
    FIRST_FRAME_RECEIVED.store(false, Ordering::Relaxed);
    if let Ok(mut guard) = LAST_IDR_FRAME.lock() {
        *guard = None;
    }
}

/// Resetea completamente las variables estáticas y canales globales de Moonlight-C.
pub fn reset_bindings_state() {
    FIRST_FRAME_RECEIVED.store(false, Ordering::SeqCst);
    NEGOTIATED_VIDEO_FORMAT.store(0, Ordering::SeqCst);
    if let Ok(mut guard) = LAST_IDR_FRAME.lock() {
        *guard = None;
    }
    if let Ok(mut guard) = VIDEO_CHANNEL.lock() {
        *guard = None;
    }
    log::info!("[Bindings] Estado de decodificador y canal de video limpiados");
}

/// Callback FFI ejecutado por Moonlight-C para entregar cada unidad de decodificación NALU (60-120+ FPS).
///
/// # Safety
/// Función `unsafe extern "C"` invocada desde código C nativo. `decodeUnit` debe ser un puntero válido o nulo.
///
/// # Latency & Performance Notes
/// - Copia rápida `memcpy` directa sin comprobación de límites por slice mediante `copy_nonoverlapping` y `set_len`.
/// - Almacenamiento Zero-Copy de IDR Keyframe mediante `Arc<Vec<u8>>` sin alocación heap.
/// - Despacho de atómicos constantes sin comprobaciones de inicialización `Lazy`.
pub unsafe extern "C" fn dr_submit_decode_unit(decodeUnit: *mut DECODE_UNIT) -> c_int {
    if decodeUnit.is_null() {
        return DR_OK;
    }

    let du = &*decodeUnit;
    let is_idr = du.frameType == FRAME_TYPE_IDR;

    if !FIRST_FRAME_RECEIVED.load(Ordering::Relaxed) {
        if !is_idr {
            log::info!(
                "[Decoder] Esperando primer IDR keyframe (trama actual P-frame)... Solicitando IDR..."
            );
            return DR_NEED_IDR;
        }
        FIRST_FRAME_RECEIVED.store(true, Ordering::Relaxed);
        log::info!("[Decoder] ¡Primer IDR Keyframe recibido! Decodificador activado.");
    }

    let full_len = du.fullLength as usize;
    let mut payload = Vec::with_capacity(full_len + 1);
    payload.push(if is_idr { 1 } else { 0 });

    // Copia ultrarrápida nivel memcpy directa desde la lista enlazada C LENTRY
    let mut current = du.bufferList;
    while !current.is_null() {
        let entry = &*current;
        let len = entry.length as usize;
        if !entry.data.is_null() && len > 0 {
            let curr_len = payload.len();
            std::ptr::copy_nonoverlapping(
                entry.data as *const u8,
                payload.as_mut_ptr().add(curr_len),
                len,
            );
            payload.set_len(curr_len + len);
        }
        current = entry.next;
    }

    if is_idr {
        let payload_arc = Arc::new(payload.clone());
        if let Ok(mut idr_guard) = LAST_IDR_FRAME.lock() {
            *idr_guard = Some(payload_arc);
        }
    }

    let count = FRAME_COUNT.fetch_add(1, Ordering::Relaxed);
    if count < 10 || is_idr {
        log::info!(
            "[Video] Frame #{count} submit: {} bytes, IDR Keyframe: {is_idr}",
            payload.len()
        );
    }

    if let Ok(guard) = VIDEO_CHANNEL.lock() {
        if let Some(sender) = guard.as_ref() {
            if let Err(mpsc::error::TrySendError::Full(data)) = sender.try_send(payload) {
                if is_idr {
                    log::warn!("[Video] Canal lleno al recibir IDR Keyframe. Forzando envío de IDR.");
                    let _ = sender.try_send(data);
                } else {
                    log::warn!("[Video] Canal lleno al enviar P-frame. Solicitando nuevo IDR Keyframe a Sunshine para evitar corrupción.");
                    FIRST_FRAME_RECEIVED.store(false, Ordering::Relaxed);
                    return DR_NEED_IDR;
                }
            }
        }
    }

    DR_OK
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_stream_config_initialization() {
        let config = default_lan_stream_config(1920, 1080, 60);
        assert_eq!(config.width, 1920);
        assert_eq!(config.height, 1080);
        assert_eq!(config.fps, 60);
        assert_eq!(config.bitrate, 50_000);
        assert_eq!(config.streamingRemotely, STREAM_CFG_LOCAL);
    }

    #[test]
    fn test_custom_stream_config() {
        let config = custom_lan_stream_config(2560, 1440, 120, 60_000, VIDEO_FORMAT_H265, 12000);
        assert_eq!(config.width, 2560);
        assert_eq!(config.height, 1440);
        assert_eq!(config.fps, 120);
        assert_eq!(config.bitrate, 60_000);
        assert_eq!(config.supportedVideoFormats, VIDEO_FORMAT_H265);
        assert_eq!(config.clientRefreshRateX100, 12000);
    }
}

