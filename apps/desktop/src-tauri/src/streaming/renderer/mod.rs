//! Subsistema de decodificación y renderizado de video para Moonlight.
//!
//! Contiene el pipeline de decodificación por hardware (Media Foundation en Windows)
//! y el dibujado de los frames NV12 usando wgpu en una ventana nativa.

pub mod decoder;
pub mod surface;
pub mod window;

use super::bindings::DECODER_RENDERER_CALLBACKS;
use std::ffi::c_void;
use std::os::raw::c_int;

/// Inicializa y retorna la estructura de callbacks que Moonlight necesita
/// para enviar los paquetes de video (NAL units) al decodificador.
pub fn create_video_callbacks() -> DECODER_RENDERER_CALLBACKS {
    DECODER_RENDERER_CALLBACKS {
        setup: Some(setup_video),
        start: Some(start_video),
        stop: Some(stop_video),
        cleanup: Some(cleanup_video),
        submitDecodeUnit: Some(submit_decode_unit),
        capabilities: 0x01, // CAPABILITY_DIRECT_SUBMIT
    }
}

unsafe extern "C" fn setup_video(
    _video_format: c_int,
    _width: c_int,
    _height: c_int,
    _redraw_rate: c_int,
    _context: *mut c_void,
    _dr_context: c_int,
) -> c_int {
    log::info!("Renderer: setup_video llamado");
    // TODO: Inicializar decoder hw
    0 // DR_OK
}

unsafe extern "C" fn start_video() {
    log::info!("Renderer: start_video llamado");
    // TODO: Iniciar loop de render
}

unsafe extern "C" fn stop_video() {
    log::info!("Renderer: stop_video llamado");
    // TODO: Detener pipeline
}

unsafe extern "C" fn cleanup_video() {
    log::info!("Renderer: cleanup_video llamado");
    // TODO: Liberar recursos de wgpu y decoder
}

unsafe extern "C" fn submit_decode_unit(
    _decode_unit: *mut super::bindings::DECODE_UNIT,
) -> c_int {
    // TODO: Enviar el frame codificado al decoder.
    // El decoder se encargará de desencolar el frame decodificado (NV12)
    // y subirlo a la textura de wgpu.
    0 // DR_OK
}
