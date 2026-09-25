//! Ventana de renderizado nativa sin bordes (winit).
//!
//! Ventana que se superpone a la UI de Tauri o funciona de forma independiente
//! para asegurar que el swapchain de wgpu pueda renderizar a máxima prioridad
//! sin la latencia añadida de los motores web (WebView).

pub struct RenderWindow {
    // winit::window::Window
    // TODO: Bucle de eventos winit independiente (en otro hilo) 
    // para no bloquear el EventLoop de Tauri.
}

impl RenderWindow {
    pub fn new() -> Self {
        Self {}
    }

    pub fn show(&self) {
        log::info!("RenderWindow visible (borderless fullscreen)");
    }

    pub fn hide(&self) {
        log::info!("RenderWindow oculta");
    }
}
