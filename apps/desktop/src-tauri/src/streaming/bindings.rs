//! FFI bindings manuales para moonlight-common-c.

#![allow(non_camel_case_types, non_snake_case, dead_code)]

use std::os::raw::{c_char, c_int, c_void};

// Polyfill para __builtin_cpu_supports en macOS x86_64
// Apple Clang no siempre enlaza compiler-rt, que contiene __cpu_model
#[cfg(all(target_os = "macos", target_arch = "x86_64"))]
#[no_mangle]
pub static mut __cpu_model: [u32; 4] = [0, 0, 0, 0];

// 1. Constantes FFI

pub const VIDEO_FORMAT_H264: i32 = 0x0001;
pub const VIDEO_FORMAT_H265: i32 = 0x0100;
pub const VIDEO_FORMAT_AV1_MAIN8: i32 = 0x1000;

pub const STREAM_CFG_LOCAL: i32 = 0;
pub const STREAM_CFG_REMOTE: i32 = 1;
pub const STREAM_CFG_AUTO: i32 = 2;

pub const FRAME_TYPE_PFRAME: i32 = 0x00;
pub const FRAME_TYPE_IDR: i32 = 0x01;

pub const DR_OK: i32 = 0;
pub const DR_NEED_IDR: i32 = -1;

// AUDIO_CONFIGURATION_STEREO = MAKE_AUDIO_CONFIGURATION(2, 0x3) = (0x3 << 16) | (2 << 8) | 0xCA = 0x000302CA
pub const AUDIO_CONFIGURATION_STEREO: i32 = 0x000302CA;

pub const ENCFLG_NONE: i32 = 0x00000000;
pub const ENCFLG_AUDIO: i32 = 0x00000001;
pub const ENCFLG_VIDEO: i32 = 0x00000002;
pub const ENCFLG_ALL: i32 = ENCFLG_AUDIO | ENCFLG_VIDEO; // 0x00000003

// 2. Estructuras C

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

#[repr(C)]
#[derive(Debug, Clone)]
pub struct LENTRY {
    pub next: *mut LENTRY,
    pub data: *mut c_char,
    pub length: c_int,
    pub bufferType: c_int,
}

#[repr(C)]
#[derive(Debug, Clone)]
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

#[repr(C)]
#[derive(Debug, Clone)]
pub struct DECODER_RENDERER_CALLBACKS {
    pub setup: DecoderRendererSetup,
    pub start: DecoderRendererStart,
    pub stop: DecoderRendererStop,
    pub cleanup: DecoderRendererCleanup,
    pub submitDecodeUnit: DecoderRendererSubmitDecodeUnit,
    pub capabilities: c_int,
}

#[repr(C)]
#[derive(Debug, Clone)]
pub struct SERVER_INFORMATION {
    pub address: *const c_char,
    pub serverInfoAppVersion: *const c_char,
    pub serverInfoGfeVersion: *const c_char,
    pub rtspSessionUrl: *const c_char,
    pub serverCodecModeSupport: c_int,
}

#[repr(C)]
#[derive(Debug, Clone)]
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

// 3. Declaraciones de funciones C (Importadas de Limelight)

extern "C" {
    pub fn LiInitializeStreamConfiguration(streamConfig: *mut STREAM_CONFIGURATION);
    pub fn LiInitializeVideoCallbacks(drCallbacks: *mut DECODER_RENDERER_CALLBACKS);
    pub fn LiInitializeServerInformation(serverInfo: *mut SERVER_INFORMATION);
    pub fn LiInitializeConnectionCallbacks(clCallbacks: *mut CONNECTION_LISTENER_CALLBACKS);
    pub fn LiStartConnection(
        serverInfo: *mut SERVER_INFORMATION,
        streamConfig: *mut STREAM_CONFIGURATION,
        clCallbacks: *mut CONNECTION_LISTENER_CALLBACKS,
        drCallbacks: *mut DECODER_RENDERER_CALLBACKS,
        arCallbacks: *mut c_void, // Audio callbacks (null por ahora)
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
    pub fn LiGetLaunchUrlQueryParameters() -> *const c_char;
}

// 4. Wrappers Safe de Rust

/// Inicializa una `STREAM_CONFIGURATION` con valores por defecto (ceros y defaults de Moonlight).
pub fn initialize_stream_config(config: &mut STREAM_CONFIGURATION) {
    unsafe {
        LiInitializeStreamConfiguration(config as *mut _);
    }
}

/// Inicializa los callbacks del decoder de video con valores por defecto.
pub fn initialize_video_callbacks(callbacks: &mut DECODER_RENDERER_CALLBACKS) {
    unsafe {
        LiInitializeVideoCallbacks(callbacks as *mut _);
    }
}

pub fn initialize_server_information(server_info: &mut SERVER_INFORMATION) {
    unsafe {
        LiInitializeServerInformation(server_info as *mut _);
    }
}

pub fn initialize_connection_callbacks(callbacks: &mut CONNECTION_LISTENER_CALLBACKS) {
    unsafe {
        LiInitializeConnectionCallbacks(callbacks as *mut _);
    }
}

/// Devuelve los parámetros de query URL que se deben añadir a las peticiones
/// `/launch` y `/resume` de Sunshine para habilitar funcionalidad extendida.
pub fn get_launch_url_query_parameters() -> String {
    unsafe {
        let ptr = LiGetLaunchUrlQueryParameters();
        if ptr.is_null() {
            String::new()
        } else {
            std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()
        }
    }
}

/// Configuración de stream con valores razonables para LAN.
pub fn default_lan_stream_config(width: i32, height: i32, fps: i32) -> STREAM_CONFIGURATION {
    let mut config: STREAM_CONFIGURATION = unsafe { std::mem::zeroed() };
    initialize_stream_config(&mut config);

    config.width = width as c_int;
    config.height = height as c_int;
    config.fps = fps as c_int;
    config.bitrate = 50_000; // 50 Mbps
    config.packetSize = 1392;
    config.streamingRemotely = STREAM_CFG_LOCAL;
    config.audioConfiguration = AUDIO_CONFIGURATION_STEREO;
    config.supportedVideoFormats = VIDEO_FORMAT_H264;
    config.encryptionFlags = ENCFLG_ALL;
    config.clientRefreshRateX100 = (fps * 100) as c_int;

    config
}

use once_cell::sync::Lazy;
use std::sync::Mutex;
use tokio::sync::mpsc;

pub static VIDEO_CHANNEL: Lazy<Mutex<Option<mpsc::Sender<Vec<u8>>>>> =
    Lazy::new(|| Mutex::new(None));

pub fn set_video_channel(sender: mpsc::Sender<Vec<u8>>) {
    if let Ok(mut guard) = VIDEO_CHANNEL.lock() {
        *guard = Some(sender);
    }
}

pub unsafe extern "C" fn cl_stage_starting(stage: c_int) {
    log::info!("Moonlight Stage Starting: {}", stage);
}

pub unsafe extern "C" fn cl_stage_complete(stage: c_int) {
    log::info!("Moonlight Stage Complete: {}", stage);
}

pub unsafe extern "C" fn cl_stage_failed(stage: c_int, error_code: c_int) {
    log::error!(
        "Moonlight Stage Failed: stage={}, error_code={}",
        stage,
        error_code
    );
}

pub unsafe extern "C" fn cl_connection_started() {
    log::info!("Moonlight Connection Started successfully");
}

pub unsafe extern "C" fn cl_connection_terminated(error_code: c_int) {
    log::warn!("Moonlight Connection Terminated: error_code={}", error_code);
}

pub unsafe extern "C" fn cl_log_message(msg: *const c_char) {
    if !msg.is_null() {
        let s = std::ffi::CStr::from_ptr(msg).to_string_lossy();
        log::info!("[Moonlight-C] {}", s.trim_end());
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
    log::info!(
        "Video Decoder Setup: format={} {}x{}@{}fps",
        videoFormat,
        width,
        height,
        redrawRate
    );
    DR_OK
}

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
pub static FIRST_FRAME_RECEIVED: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));

pub unsafe extern "C" fn dr_start() {
    log::info!("Video Decoder Start");
    FIRST_FRAME_RECEIVED.store(false, Ordering::Relaxed);
}

pub unsafe extern "C" fn dr_stop() {
    log::info!("Video Decoder Stop");
    FIRST_FRAME_RECEIVED.store(false, Ordering::Relaxed);
}

pub unsafe extern "C" fn dr_cleanup() {
    log::info!("Video Decoder Cleanup");
    FIRST_FRAME_RECEIVED.store(false, Ordering::Relaxed);
}

pub unsafe extern "C" fn dr_submit_decode_unit(decodeUnit: *mut DECODE_UNIT) -> c_int {
    if decodeUnit.is_null() {
        return DR_OK;
    }

    let du = &*decodeUnit;
    let is_idr = du.frameType == FRAME_TYPE_IDR;

    if !FIRST_FRAME_RECEIVED.load(Ordering::Relaxed) {
        if !is_idr {
            log::info!(
                "Frame is not IDR and FIRST_FRAME_RECEIVED is false. Requesting IDR keyframe..."
            );
            return DR_NEED_IDR;
        }
        FIRST_FRAME_RECEIVED.store(true, Ordering::Relaxed);
        log::info!("Received first IDR keyframe! Video decoder active.");
    }

    let mut payload = Vec::with_capacity(du.fullLength as usize + 1);
    payload.push(if is_idr { 1 } else { 0 });

    let mut current = du.bufferList;
    while !current.is_null() {
        let entry = &*current;
        if !entry.data.is_null() && entry.length > 0 {
            let slice = std::slice::from_raw_parts(entry.data as *const u8, entry.length as usize);
            payload.extend_from_slice(slice);
        }
        current = entry.next;
    }

    static FRAME_COUNT: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(0));
    let count = FRAME_COUNT.fetch_add(1, Ordering::Relaxed);
    if count < 10 || is_idr {
        log::info!(
            "Video frame #{} submit: {} bytes, IDR: {}",
            count,
            payload.len(),
            is_idr
        );
    }

    if let Ok(guard) = VIDEO_CHANNEL.lock() {
        if let Some(sender) = guard.as_ref() {
            let _ = sender.try_send(payload);
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
}
