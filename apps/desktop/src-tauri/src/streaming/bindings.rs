//! FFI bindings manuales para moonlight-common-c.

#![allow(non_camel_case_types, non_snake_case, dead_code)]

use std::os::raw::{c_char, c_int, c_void};

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
pub const ENCFLG_ALL: i32 = -1; // 0xFFFFFFFF en C

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

// 3. Declaraciones de funciones C (Importadas de Limelight)

extern "C" {
    pub fn LiInitializeStreamConfiguration(streamConfig: *mut STREAM_CONFIGURATION);
    pub fn LiInitializeVideoCallbacks(drCallbacks: *mut DECODER_RENDERER_CALLBACKS);
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
    config.supportedVideoFormats = VIDEO_FORMAT_H264 | VIDEO_FORMAT_H265;
    config.encryptionFlags = ENCFLG_ALL;
    config.clientRefreshRateX100 = (fps * 100) as c_int;

    config
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
