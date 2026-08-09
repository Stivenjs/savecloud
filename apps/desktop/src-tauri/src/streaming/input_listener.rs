//! Escucha nativa multiplataforma de eventos de teclado y ratón directamente en Rust.
//!
//! Intercepta eventos físicos de hardware (Windows, macOS, Linux) en un hilo nativo de Rust
//! y los enruta directamente al módulo `input_relay` hacia el host Sunshine sin involucrar JavaScript.
//!
//! ## Plataformas soportadas
//!
//! - **Windows** — Hooks de bajo nivel (`WH_MOUSE_LL`) + polling `GetAsyncKeyState`.
//! - **macOS / Linux** — Librería `rdev` con escucha global de eventos.

use std::sync::atomic::{AtomicBool, AtomicI32, AtomicIsize, Ordering};
use std::time::Duration;

use tauri::{Window, WindowEvent};

use super::input_relay::{
    relay_keyboard_event, relay_mouse_button, relay_mouse_position, relay_scroll, MouseButton,
};

/// Intervalo de polling para lectura de teclado/ratón en Windows (250 Hz).
const POLL_INTERVAL: Duration = Duration::from_millis(4);

/// Etiqueta de la ventana de streaming en Tauri.
const STREAMING_WINDOW_LABEL: &str = "streaming-window";

/// Métricas globales de la ventana de streaming, agrupadas en un solo struct
/// para mantener la cohesión y evitar atomics dispersos.
///
/// # Ordenamiento de memoria
///
/// Se usa `Ordering::Relaxed` porque cada campo es independiente entre sí.
/// Las lecturas ligeramente desactualizadas son tolerables: el siguiente tick
/// de polling corregirá el valor.
pub struct WindowMetrics {
    /// Si la ventana de streaming tiene foco actualmente.
    pub focused: AtomicBool,
    /// Handle nativo de la ventana (HWND en Windows). `isize` para soportar handles de 64-bit.
    pub hwnd: AtomicIsize,
    /// Posición X de la esquina superior-izquierda (coordenadas de pantalla).
    pub pos_x: AtomicI32,
    /// Posición Y de la esquina superior-izquierda (coordenadas de pantalla).
    pub pos_y: AtomicI32,
    /// Ancho interior de la ventana en píxeles.
    pub width: AtomicI32,
    /// Alto interior de la ventana en píxeles.
    pub height: AtomicI32,
}

impl WindowMetrics {
    const fn new() -> Self {
        Self {
            focused: AtomicBool::new(false),
            hwnd: AtomicIsize::new(0),
            pos_x: AtomicI32::new(0),
            pos_y: AtomicI32::new(0),
            width: AtomicI32::new(0),
            height: AtomicI32::new(0),
        }
    }

    /// ¿La ventana de streaming está enfocada?
    #[inline]
    pub fn is_focused(&self) -> bool {
        self.focused.load(Ordering::Relaxed)
    }

    /// Actualiza la posición exterior de la ventana.
    #[inline]
    fn update_position(&self, x: i32, y: i32) {
        self.pos_x.store(x, Ordering::Relaxed);
        self.pos_y.store(y, Ordering::Relaxed);
    }

    /// Actualiza el tamaño interior de la ventana.
    #[inline]
    fn update_size(&self, w: i32, h: i32) {
        self.width.store(w, Ordering::Relaxed);
        self.height.store(h, Ordering::Relaxed);
    }

    /// Resetea el estado al destruirse la ventana.
    fn reset(&self) {
        self.focused.store(false, Ordering::Relaxed);
        self.hwnd.store(0, Ordering::Relaxed);
    }
}

/// Estado global de la ventana de streaming, accesible desde cualquier hilo.
pub static STREAMING_WINDOW: WindowMetrics = WindowMetrics::new();

// Aliases estáticos para compatibilidad con módulos que referencian los nombres anteriores.
// En futuras iteraciones estos pueden eliminarse en favor de `STREAMING_WINDOW.field`.
#[expect(
    dead_code,
    reason = "Aliases de compatibilidad para módulos que usen los nombres anteriores"
)]
pub static STREAMING_WINDOW_FOCUSED: &AtomicBool = &STREAMING_WINDOW.focused;
#[expect(dead_code, reason = "Alias de compatibilidad")]
pub static STREAMING_WINDOW_POS_X: &AtomicI32 = &STREAMING_WINDOW.pos_x;
#[expect(dead_code, reason = "Alias de compatibilidad")]
pub static STREAMING_WINDOW_POS_Y: &AtomicI32 = &STREAMING_WINDOW.pos_y;
#[expect(dead_code, reason = "Alias de compatibilidad")]
pub static STREAMING_WINDOW_WIDTH: &AtomicI32 = &STREAMING_WINDOW.width;
#[expect(dead_code, reason = "Alias de compatibilidad")]
pub static STREAMING_WINDOW_HEIGHT: &AtomicI32 = &STREAMING_WINDOW.height;

/// Registra los eventos de foco, movimiento, redimensionamiento y destrucción de la ventana de streaming.
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != STREAMING_WINDOW_LABEL {
        return;
    }

    match event {
        WindowEvent::Focused(focused) => {
            STREAMING_WINDOW.focused.store(*focused, Ordering::Relaxed);

            if let Ok(pos) = window.outer_position() {
                STREAMING_WINDOW.update_position(pos.x, pos.y);
            }
            if let Ok(size) = window.inner_size() {
                STREAMING_WINDOW.update_size(size.width as i32, size.height as i32);
            }

            #[cfg(target_os = "windows")]
            {
                if let Ok(hwnd) = window.hwnd() {
                    STREAMING_WINDOW
                        .hwnd
                        .store(hwnd.0 as isize, Ordering::Relaxed);
                }
            }

            log::info!("[InputListener] Foco de ventana de streaming: {}", focused);
        }
        WindowEvent::Moved(pos) => {
            STREAMING_WINDOW.update_position(pos.x, pos.y);
        }
        WindowEvent::Resized(size) => {
            STREAMING_WINDOW.update_size(size.width as i32, size.height as i32);
        }
        WindowEvent::Destroyed => {
            STREAMING_WINDOW.reset();
            log::info!("[InputListener] Ventana de streaming destruida");
        }
        _ => {}
    }
}

#[cfg(target_os = "windows")]
mod windows_listener {
    use super::*;
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    /// Hook de bajo nivel para interceptar eventos de scroll del ratón.
    ///
    /// # Safety
    ///
    /// Callback invocado por el subsistema de hooks de Windows.
    /// Solo accedemos al struct `MSLLHOOKSTRUCT` cuando `n_code >= 0`.
    pub(super) unsafe extern "system" fn mouse_hook_proc(
        n_code: i32,
        w_param: usize,
        l_param: isize,
    ) -> isize {
        if n_code >= 0 && STREAMING_WINDOW.is_focused() && w_param as u32 == WM_MOUSEWHEEL {
            // SAFETY: l_param apunta a un MSLLHOOKSTRUCT válido cuando n_code >= 0.
            let ms = unsafe { *(l_param as *const MSLLHOOKSTRUCT) };
            let delta = ((ms.mouseData >> 16) & 0xffff) as i16;
            let clicks: i8 = if delta > 0 { 1 } else { -1 };
            relay_scroll(clicks);
        }
        unsafe { CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param) }
    }

    /// Construye flags de modificadores leyendo el estado actual de las teclas especiales.
    ///
    /// Retorna un bitmap: Shift=0x01, Ctrl=0x02, Alt=0x04, Meta=0x08.
    fn build_modifier_flags() -> u8 {
        let mut flags: u8 = 0;

        // SAFETY: GetAsyncKeyState es thread-safe para lectura del estado global de teclas.
        unsafe {
            if (GetAsyncKeyState(0xA0) as u16 & 0x8000 != 0)
                || (GetAsyncKeyState(0xA1) as u16 & 0x8000 != 0)
            {
                flags |= 0x01; // Shift
            }
            if (GetAsyncKeyState(0xA2) as u16 & 0x8000 != 0)
                || (GetAsyncKeyState(0xA3) as u16 & 0x8000 != 0)
            {
                flags |= 0x02; // Ctrl
            }
            if GetAsyncKeyState(0x12) as u16 & 0x8000 != 0 {
                flags |= 0x04; // Alt
            }
            if (GetAsyncKeyState(0x5B) as u16 & 0x8000 != 0)
                || (GetAsyncKeyState(0x5C) as u16 & 0x8000 != 0)
            {
                flags |= 0x08; // Meta (Win)
            }
        }
        flags
    }

    /// Hilo del hook de scroll del ratón (WH_MOUSE_LL).
    pub(super) fn spawn_mouse_hook_thread() {
        std::thread::spawn(move || {
            // SAFETY: Instalamos un hook global de ratón de bajo nivel.
            let hook = unsafe {
                SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), std::ptr::null_mut(), 0)
            };

            if hook.is_null() {
                log::error!("[InputListener] No se pudo instalar hook de ratón WH_MOUSE_LL");
                return;
            }

            // Bomba de mensajes requerida para que el hook funcione.
            // SAFETY: MSG es un struct POD sin invariantes; zeroed es válido.
            let mut msg = unsafe { std::mem::zeroed::<MSG>() };
            // SAFETY: GetMessageW bloquea hasta recibir un mensaje. Loop estándar de Windows.
            unsafe {
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                UnhookWindowsHookEx(hook);
            }
        });
    }

    /// Hilo de polling de teclado, ratón y posición del cursor a 250 Hz.
    pub(super) fn spawn_input_polling_thread() {
        std::thread::spawn(move || {
            let mut prev_keys = [false; 256];

            loop {
                if !STREAMING_WINDOW.is_focused() {
                    prev_keys.fill(false);
                    std::thread::sleep(POLL_INTERVAL);
                    continue;
                }

                poll_cursor_position();
                poll_keyboard_state(&mut prev_keys);
                std::thread::sleep(POLL_INTERVAL);
            }
        });
    }

    /// Lee la posición del cursor y la convierte a coordenadas relativas de la ventana.
    fn poll_cursor_position() {
        let hwnd =
            STREAMING_WINDOW.hwnd.load(Ordering::Relaxed) as windows_sys::Win32::Foundation::HWND;

        if hwnd.is_null() {
            return;
        }

        let mut cursor_pos = POINT { x: 0, y: 0 };
        let mut window_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };

        // SAFETY: Ambas funciones son thread-safe para lectura de estado.
        let cursor_ok = unsafe { GetCursorPos(&mut cursor_pos) } != 0;
        let rect_ok = unsafe { GetWindowRect(hwnd, &mut window_rect) } != 0;

        if !cursor_ok || !rect_ok {
            return;
        }

        let width = (window_rect.right - window_rect.left) as i16;
        let height = (window_rect.bottom - window_rect.top) as i16;

        if width > 0 && height > 0 {
            let rel_x = (cursor_pos.x - window_rect.left).clamp(0, width as i32) as i16;
            let rel_y = (cursor_pos.y - window_rect.top).clamp(0, height as i32) as i16;
            relay_mouse_position(rel_x, rel_y, width, height);
        }
    }

    /// Escanea el estado de todas las teclas y botones del ratón, emitiendo eventos de cambio.
    fn poll_keyboard_state(prev_keys: &mut [bool; 256]) {
        let modifiers = build_modifier_flags();

        for vk in 1u16..=255 {
            // SAFETY: GetAsyncKeyState es thread-safe para lectura de estado global.
            let state = unsafe { GetAsyncKeyState(vk as i32) };
            let is_down = (state as u16 & 0x8000) != 0;

            if is_down == prev_keys[vk as usize] {
                continue;
            }
            prev_keys[vk as usize] = is_down;

            // VK 0x01–0x06: botones de ratón.
            if (0x01..=0x06).contains(&vk) {
                if let Some(btn) = vk_to_mouse_button(vk) {
                    relay_mouse_button(btn, is_down);
                }
            } else {
                relay_keyboard_event(vk, is_down, modifiers);
            }
        }
    }

    /// Mapea códigos VK de ratón (0x01–0x06) a `MouseButton`.
    fn vk_to_mouse_button(vk: u16) -> Option<MouseButton> {
        match vk {
            0x01 => Some(MouseButton::Left),
            0x04 => Some(MouseButton::Middle),
            0x02 => Some(MouseButton::Right),
            0x05 => Some(MouseButton::X1),
            0x06 => Some(MouseButton::X2),
            _ => None,
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod posix_listener {
    use super::*;

    /// Hilo de escucha global de eventos via `rdev`.
    pub(super) fn spawn_rdev_listener() {
        std::thread::spawn(move || {
            log::info!(
                "[InputListener] Hilo nativo rdev de captura inicializado en POSIX (macOS/Linux)"
            );

            if let Err(error) = rdev::listen(move |event: rdev::Event| {
                if !STREAMING_WINDOW.is_focused() {
                    return;
                }
                dispatch_rdev_event(event);
            }) {
                log::error!("[InputListener] Error en escuchador rdev: {:?}", error);
            }
        });
    }

    /// Despacha un evento rdev al relay correspondiente.
    fn dispatch_rdev_event(event: rdev::Event) {
        match event.event_type {
            rdev::EventType::KeyPress(key) => {
                let vk = map_rdev_key_to_vk(key);
                if vk != 0 {
                    let modifiers = build_rdev_modifier_flags(key, true);
                    relay_keyboard_event(vk, true, modifiers);
                }
            }
            rdev::EventType::KeyRelease(key) => {
                let vk = map_rdev_key_to_vk(key);
                if vk != 0 {
                    let modifiers = build_rdev_modifier_flags(key, false);
                    relay_keyboard_event(vk, false, modifiers);
                }
            }
            rdev::EventType::MouseMove { x, y } => {
                handle_mouse_move(x, y);
            }
            rdev::EventType::Wheel {
                delta_x: _,
                delta_y,
            } => {
                handle_scroll(delta_y);
            }
            rdev::EventType::ButtonPress(button) => {
                if let Some(btn) = map_rdev_button(button) {
                    relay_mouse_button(btn, true);
                }
            }
            rdev::EventType::ButtonRelease(button) => {
                if let Some(btn) = map_rdev_button(button) {
                    relay_mouse_button(btn, false);
                }
            }
            _ => {}
        }
    }

    /// Convierte posición absoluta del cursor a coordenadas relativas de la ventana.
    fn handle_mouse_move(x: f64, y: f64) {
        let win_x = STREAMING_WINDOW.pos_x.load(Ordering::Relaxed);
        let win_y = STREAMING_WINDOW.pos_y.load(Ordering::Relaxed);
        let win_w = STREAMING_WINDOW.width.load(Ordering::Relaxed);
        let win_h = STREAMING_WINDOW.height.load(Ordering::Relaxed);

        if win_w > 0 && win_h > 0 {
            let rel_x = (x as i32 - win_x).clamp(0, win_w) as i16;
            let rel_y = (y as i32 - win_y).clamp(0, win_h) as i16;
            relay_mouse_position(rel_x, rel_y, win_w as i16, win_h as i16);
        }
    }

    /// Procesa evento de scroll. Usa high-res si el delta no es discreto (±1).
    fn handle_scroll(delta_y: i64) {
        match delta_y {
            1.. => relay_scroll(1),
            ..=-1 => relay_scroll(-1),
            0 => {}
        }
    }

    /// Mapea botones rdev a `MouseButton`.
    fn map_rdev_button(button: rdev::Button) -> Option<MouseButton> {
        match button {
            rdev::Button::Left => Some(MouseButton::Left),
            rdev::Button::Middle => Some(MouseButton::Middle),
            rdev::Button::Right => Some(MouseButton::Right),
            rdev::Button::Unknown(4) => Some(MouseButton::X1),
            rdev::Button::Unknown(5) => Some(MouseButton::X2),
            _ => None,
        }
    }

    /// Estado mutable de modificadores activos para el hilo rdev.
    ///
    /// `rdev` no expone una API para consultar el estado global de modificadores,
    /// así que los trackeamos manualmente con cada evento key press/release.
    use std::sync::atomic::AtomicU8;
    static RDEV_MODIFIERS: AtomicU8 = AtomicU8::new(0);

    /// Actualiza y retorna los flags de modificadores basándose en la tecla actual.
    fn build_rdev_modifier_flags(key: rdev::Key, pressed: bool) -> u8 {
        let flag = match key {
            rdev::Key::ShiftLeft | rdev::Key::ShiftRight => 0x01,
            rdev::Key::ControlLeft | rdev::Key::ControlRight => 0x02,
            rdev::Key::Alt | rdev::Key::AltGr => 0x04,
            rdev::Key::MetaLeft | rdev::Key::MetaRight => 0x08,
            _ => return RDEV_MODIFIERS.load(Ordering::Relaxed),
        };

        if pressed {
            RDEV_MODIFIERS.fetch_or(flag, Ordering::Relaxed);
        } else {
            RDEV_MODIFIERS.fetch_and(!flag, Ordering::Relaxed);
        }
        RDEV_MODIFIERS.load(Ordering::Relaxed)
    }

    /// Mapea las teclas rdev de POSIX (macOS / Linux) a códigos Win32 Virtual Key (VK) para Sunshine.
    ///
    /// Cobertura completa: letras, números, F-keys, navegación, numpad, puntuación, locks y system.
    fn map_rdev_key_to_vk(key: rdev::Key) -> u16 {
        use rdev::Key::*;
        match key {
            // ── Letras A–Z ──
            KeyA => 0x41,
            KeyB => 0x42,
            KeyC => 0x43,
            KeyD => 0x44,
            KeyE => 0x45,
            KeyF => 0x46,
            KeyG => 0x47,
            KeyH => 0x48,
            KeyI => 0x49,
            KeyJ => 0x4A,
            KeyK => 0x4B,
            KeyL => 0x4C,
            KeyM => 0x4D,
            KeyN => 0x4E,
            KeyO => 0x4F,
            KeyP => 0x50,
            KeyQ => 0x51,
            KeyR => 0x52,
            KeyS => 0x53,
            KeyT => 0x54,
            KeyU => 0x55,
            KeyV => 0x56,
            KeyW => 0x57,
            KeyX => 0x58,
            KeyY => 0x59,
            KeyZ => 0x5A,

            // ── Números 0–9 ──
            Num0 => 0x30,
            Num1 => 0x31,
            Num2 => 0x32,
            Num3 => 0x33,
            Num4 => 0x34,
            Num5 => 0x35,
            Num6 => 0x36,
            Num7 => 0x37,
            Num8 => 0x38,
            Num9 => 0x39,

            // ── Teclas de función F1–F12 ──
            F1 => 0x70,
            F2 => 0x71,
            F3 => 0x72,
            F4 => 0x73,
            F5 => 0x74,
            F6 => 0x75,
            F7 => 0x76,
            F8 => 0x77,
            F9 => 0x78,
            F10 => 0x79,
            F11 => 0x7A,
            F12 => 0x7B,

            // ── Teclas especiales ──
            Space => 0x20,
            Return => 0x0D,
            Escape => 0x1B,
            Tab => 0x09,
            BackSpace => 0x08,

            // ── Modificadores ──
            ShiftLeft => 0xA0,
            ShiftRight => 0xA1,
            ControlLeft => 0xA2,
            ControlRight => 0xA3,
            Alt => 0xA4,       // VK_LMENU
            AltGr => 0xA5,     // VK_RMENU
            MetaLeft => 0x5B,  // VK_LWIN
            MetaRight => 0x5C, // VK_RWIN

            // ── Navegación ──
            UpArrow => 0x26,
            DownArrow => 0x28,
            LeftArrow => 0x25,
            RightArrow => 0x27,
            Home => 0x24,
            End => 0x23,
            PageUp => 0x21,
            PageDown => 0x22,
            Insert => 0x2D,
            Delete => 0x2E,

            // ── Locks ──
            CapsLock => 0x14,
            NumLock => 0x90,
            ScrollLock => 0x91,

            // ── System ──
            PrintScreen => 0x2C,
            Pause => 0x13,

            // ── Numpad ──
            Kp0 => 0x60,
            Kp1 => 0x61,
            Kp2 => 0x62,
            Kp3 => 0x63,
            Kp4 => 0x64,
            Kp5 => 0x65,
            Kp6 => 0x66,
            Kp7 => 0x67,
            Kp8 => 0x68,
            Kp9 => 0x69,
            KpMultiply => 0x6A,
            KpPlus => 0x6B,
            KpMinus => 0x6D,
            KpDecimal => 0x6E,
            KpDivide => 0x6F,
            KpReturn => 0x0D, // VK_RETURN (mismo que Enter principal)

            // ── Puntuación y símbolos ──
            SemiColon => 0xBA,    // VK_OEM_1 ( ;: )
            Equal => 0xBB,        // VK_OEM_PLUS ( =+ )
            Comma => 0xBC,        // VK_OEM_COMMA ( ,< )
            Minus => 0xBD,        // VK_OEM_MINUS ( -_ )
            Dot => 0xBE,          // VK_OEM_PERIOD ( .> )
            Slash => 0xBF,        // VK_OEM_2 ( /? )
            BackQuote => 0xC0,    // VK_OEM_3 ( `~ )
            LeftBracket => 0xDB,  // VK_OEM_4 ( [{ )
            BackSlash => 0xDC,    // VK_OEM_5 ( \| )
            RightBracket => 0xDD, // VK_OEM_6 ( ]} )
            Quote => 0xDE,        // VK_OEM_7 ( '" )

            _ => 0,
        }
    }
}

/// Inicia el hilo nativo de Rust para capturar entradas físicas de Teclado y Ratón
/// cuando la ventana de streaming está enfocada.
pub fn start_native_input_listener() {
    #[cfg(target_os = "windows")]
    {
        windows_listener::spawn_mouse_hook_thread();
        windows_listener::spawn_input_polling_thread();
    }

    #[cfg(not(target_os = "windows"))]
    {
        posix_listener::spawn_rdev_listener();
    }
}
