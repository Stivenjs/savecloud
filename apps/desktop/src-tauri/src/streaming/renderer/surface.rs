//! Pipeline de renderizado usando wgpu.
//!
//! Se encarga de tomar las texturas de formato NV12 (YUV 4:2:0) que provienen del 
//! HardwareDecoder, aplicarles un shader de conversión de espacio de color a RGB, 
//! y presentarlas en la RenderWindow minimizando la latencia.

pub struct WgpuSurface {
    // wgpu::Instance, Device, Queue, Surface
    // Pipeline de conversión YUV->RGB
}

impl WgpuSurface {
    pub fn new() -> Self {
        Self {}
    }

    /// Inicializa la superficie apuntando a la ventana nativa (RenderWindow).
    pub fn initialize(&self) -> Result<(), String> {
        // 1. Instance::new
        // 2. Surface::create_surface
        // 3. Request adapter & device
        // 4. Create bind groups y shader modules (NV12 -> RGB)
        log::info!("WgpuSurface inicializada (Placeholder)");
        Ok(())
    }

    /// Sube los planos Luma (Y) y Chroma (UV) a las texturas de la GPU
    /// y encola el renderizado de un frame.
    pub fn render_frame_nv12(&self, _y_plane: &[u8], _uv_plane: &[u8], _width: u32, _height: u32) {
        // En una implementación cero-copias, intentaríamos compartir el buffer de D3D11 
        // de Media Foundation directamente con wgpu vía extensiones, en vez de copiar
        // los bytes a RAM y luego a VRAM.
    }
}
