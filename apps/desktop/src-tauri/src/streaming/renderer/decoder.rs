//! Decodificador de video por hardware (Media Foundation / DXVA).
//!
//! Recibe los NAL units empaquetados por Moonlight y los envía a la 
//! cola de Media Foundation para decodificación H.264 o HEVC con aceleración GPU.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

pub struct HardwareDecoder {
    is_initialized: AtomicBool,
    // TODO: ComObject de IMFTransform (MFT) para H264/HEVC
    // TODO: ComObject de IMFSample para inyectar NAL units
}

impl HardwareDecoder {
    pub fn new() -> Self {
        Self {
            is_initialized: AtomicBool::new(false),
        }
    }

    /// Inicializa Media Foundation (MFStartup) y crea la topología.
    pub fn initialize(&self, codec: VideoCodec) -> Result<(), String> {
        // En Windows, llamaríamos a MFStartup y buscaríamos un MFT 
        // (Media Foundation Transform) compatible con H264/HEVC
        // con soporte D3D11-aware para salida en VRAM directa (DXGI_FORMAT_NV12).
        
        self.is_initialized.store(true, Ordering::SeqCst);
        log::info!("HardwareDecoder inicializado para {:?}", codec);
        Ok(())
    }

    /// Recibe un DECODE_UNIT desde Moonlight y lo procesa.
    pub fn submit_decode_unit(&self, _data: &[u8], _frame_type: FrameType) -> Result<(), String> {
        if !self.is_initialized.load(Ordering::SeqCst) {
            return Err("Decoder no inicializado".into());
        }

        // 1. Envolver el slice en un IMFMediaBuffer
        // 2. Crear un IMFSample y atacharlo
        // 3. Pasar a mft->ProcessInput
        // 4. Intentar mft->ProcessOutput para ver si hay un frame listo

        Ok(())
    }

    /// Libera recursos de Media Foundation (MFShutdown).
    pub fn shutdown(&self) {
        if self.is_initialized.swap(false, Ordering::SeqCst) {
            log::info!("HardwareDecoder apagado");
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VideoCodec {
    H264,
    HEVC,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FrameType {
    IDR,
    PFrame,
}
