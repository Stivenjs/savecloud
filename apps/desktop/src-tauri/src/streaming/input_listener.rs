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
#[cfg(target_os = "windows")]
use std::sync::atomic::AtomicU32;
use std::sync::{Condvar, Mutex};
#[cfg(target_os = "windows")]
use std::time::Duration;

use tauri::{Window, WindowEvent};

use super::input_relay::{
    relay_keyboard_event, relay_mouse_button, relay_mouse_position,
    relay_scroll, MouseButton,
};
#[cfg(target_os = "windows")]
use super::input_relay::relay_mouse_move;

/// Intervalo de polling para lectura de teclado/ratón en Windows durante streaming activo (250 Hz).
#[cfg(target_os = "windows")]
const POLL_INTERVAL: Duration = Duration::from_millis(4);

/// Etiqueta de la ventana de streaming en Tauri.
const STREAMING_WINDOW_LABEL: &str = "streaming-window";

/// Estado de ejecución global del listener nativo.
static IS_LISTENER_RUNNING: AtomicBool = AtomicBool::new(true);

/// Condvar para suspender el hilo de polling cuando la ventana de streaming no esté enfocada.
/// Evita despertar 250 veces por segundo en reposo (0% CPU).
static STREAMING_FOCUS_CV: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

pub(crate) fn notify_streaming_focus_change(focused: bool) {
    let (lock, cvar) = &STREAMING_FOCUS_CV;
    if let Ok(mut state) = lock.lock() {
        *state = focused;
        cvar.notify_all();
    }
}

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
            notify_streaming_focus_change(*focused);

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
                if *focused {
                    windows_listener::confine_mouse_to_window();
                } else {
                    windows_listener::release_all_active_keys();
                    windows_listener::release_mouse_confinement();
                }
            }

            log::info!("[InputListener] Foco de ventana de streaming: {}", focused);
        }
        WindowEvent::Moved(pos) => {
            STREAMING_WINDOW.update_position(pos.x, pos.y);
            #[cfg(target_os = "windows")]
            if STREAMING_WINDOW.is_focused() {
                windows_listener::confine_mouse_to_window();
            }
        }
        WindowEvent::Resized(size) => {
            STREAMING_WINDOW.update_size(size.width as i32, size.height as i32);
            #[cfg(target_os = "windows")]
            if STREAMING_WINDOW.is_focused() {
                windows_listener::confine_mouse_to_window();
            }
        }
        WindowEvent::Destroyed => {
            STREAMING_WINDOW.reset();
            notify_streaming_focus_change(false);
            #[cfg(target_os = "windows")]
            {
                windows_listener::release_all_active_keys();
                windows_listener::release_mouse_confinement();
            }
            log::info!("[InputListener] Ventana de streaming destruida");
        }
        _ => {}
    }
}

#[cfg(target_os = "windows")]
pub mod windows_listener {
    use super::*;
    use windows_sys::Win32::Foundation::{POINT, RECT};
    use windows_sys::Win32::Graphics::Gdi::{ClientToScreen, ScreenToClient};
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    use windows_sys::Win32::UI::WindowsAndMessaging::*;

    static HOOK_THREAD_ID: AtomicU32 = AtomicU32::new(0);

    /// Libera todas las teclas de teclado activas enviando eventos KEY_ACTION_UP hacia el host.
    pub fn release_all_active_keys() {
        super::super::input_relay::release_all_keyboard_keys();
    }

    /// Confina el cursor del ratón exclusivamente dentro del área cliente real de la ventana.
    pub fn confine_mouse_to_window() {
        if crate::streaming::is_mirror_mode() {
            return;
        }

        let hwnd =
            STREAMING_WINDOW.hwnd.load(Ordering::Relaxed) as windows_sys::Win32::Foundation::HWND;
        if hwnd.is_null() {
            return;
        }

        let mut client_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        // SAFETY: GetClientRect y ClientToScreen mapean de manera precisa el área interna.
        unsafe {
            if GetClientRect(hwnd, &mut client_rect) != 0 {
                let mut top_left = POINT {
                    x: client_rect.left,
                    y: client_rect.top,
                };
                let mut bottom_right = POINT {
                    x: client_rect.right,
                    y: client_rect.bottom,
                };
                if ClientToScreen(hwnd, &mut top_left) != 0
                    && ClientToScreen(hwnd, &mut bottom_right) != 0
                {
                    let screen_rect = RECT {
                        left: top_left.x,
                        top: top_left.y,
                        right: bottom_right.x,
                        bottom: bottom_right.y,
                    };
                    ClipCursor(&screen_rect);
                }
            }
        }
    }

    /// Libera el confinamiento del cursor para navegación libre fuera de la ventana de streaming.
    pub fn release_mouse_confinement() {
        // SAFETY: ClipCursor(null) restablece los límites del puntero a toda la pantalla.
        unsafe {
            ClipCursor(std::ptr::null());
        }
    }

    /// Desinstala inmediatamente los hooks nativos de Windows en el cierre de la app.
    pub fn stop_hooks_thread() {
        release_mouse_confinement();
        release_all_active_keys();

        let thread_id = HOOK_THREAD_ID.swap(0, Ordering::Relaxed);
        if thread_id != 0 {
            // SAFETY: PostThreadMessageW envía WM_QUIT al hilo del hook para terminar el loop GetMessageW limpiamente.
            unsafe {
                PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
            }
        }
    }

    /// Hook de bajo nivel para interceptar la tecla Windows (VK_LWIN / VK_RWIN) y atajos de liberación.
    ///
    /// # Safety
    /// Callback invocado por el sistema operativo Windows para el hook `WH_KEYBOARD_LL`.
    pub(super) unsafe extern "system" fn keyboard_hook_proc(
        n_code: i32,
        w_param: usize,
        l_param: isize,
    ) -> isize {
        if !IS_LISTENER_RUNNING.load(Ordering::Relaxed) || crate::streaming::is_mirror_mode() {
            return unsafe { CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param) };
        }

        if n_code >= 0 && STREAMING_WINDOW.is_focused() {
            // SAFETY: l_param apunta a un KBDLLHOOKSTRUCT válido cuando n_code >= 0.
            let kb = unsafe { *(l_param as *const KBDLLHOOKSTRUCT) };
            let vk = kb.vkCode as u16;

            // Interceptación de la tecla Windows (VK_LWIN = 0x5B, VK_RWIN = 0x5C)
            if vk == 0x5B || vk == 0x5C {
                let is_down = (w_param as u32 == WM_KEYDOWN) || (w_param as u32 == WM_SYSKEYDOWN);
                let modifiers = build_modifier_flags();

                relay_keyboard_event(vk, is_down, modifiers);

                // Retornar 1 suprime la tecla localmente (evita abrir el Menú Inicio en el cliente)
                return 1;
            }

            // Atajo de liberación del mouse: Ctrl + Shift + Alt + Esc (vk = 0x1B) o Q (vk = 0x51)
            if (vk == 0x1B || vk == 0x51) && (build_modifier_flags() == 0x07) {
                release_mouse_confinement();
                log::info!("[InputListener] Atajo de liberación activado: Mouse desconfinado");
            }
        }

        unsafe { CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param) }
    }

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
        if !IS_LISTENER_RUNNING.load(Ordering::Relaxed) || crate::streaming::is_mirror_mode() {
            return unsafe { CallNextHookEx(std::ptr::null_mut(), n_code, w_param, l_param) };
        }

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

    /// Hilo del hook de scroll del ratón y teclado (WH_MOUSE_LL y WH_KEYBOARD_LL).
    pub(super) fn spawn_mouse_hook_thread() {
        std::thread::spawn(move || {
            let tid = unsafe { GetCurrentThreadId() };
            HOOK_THREAD_ID.store(tid, Ordering::Relaxed);

            // SAFETY: Instalamos un hook global de ratón y teclado de bajo nivel.
            let mouse_hook = unsafe {
                SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook_proc), std::ptr::null_mut(), 0)
            };
            let kb_hook = unsafe {
                SetWindowsHookExW(
                    WH_KEYBOARD_LL,
                    Some(keyboard_hook_proc),
                    std::ptr::null_mut(),
                    0,
                )
            };

            if mouse_hook.is_null() || kb_hook.is_null() {
                log::error!("[InputListener] No se pudo instalar hook de ratón o teclado WH_MOUSE_LL / WH_KEYBOARD_LL");
                return;
            }

            // Bomba de mensajes requerida para que el hook funcione.
            let mut msg = unsafe { std::mem::zeroed::<MSG>() };
            // SAFETY: GetMessageW bloquea hasta recibir un mensaje.
            unsafe {
                while IS_LISTENER_RUNNING.load(Ordering::Relaxed)
                    && GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0
                {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                if !mouse_hook.is_null() {
                    UnhookWindowsHookEx(mouse_hook);
                }
                if !kb_hook.is_null() {
                    UnhookWindowsHookEx(kb_hook);
                }
            }
            log::info!("[InputListener] Hilo Win32 Hook desinstalado exitosamente");
        });
    }

    /// Hilo de polling de teclado, ratón y posición del cursor a 250 Hz durante streaming activo.
    /// Cuando la ventana de streaming no está enfocada, el hilo se suspende en el kernel mediante
    /// Condvar (`cvar.wait`), reduciendo el uso de CPU al 0.0% en reposo.
    pub(super) fn spawn_input_polling_thread() {
        std::thread::spawn(move || {
            let mut prev_keys = [false; 256];

            loop {
                if !IS_LISTENER_RUNNING.load(Ordering::Relaxed) {
                    break;
                }

                if !STREAMING_WINDOW.is_focused() || crate::streaming::is_mirror_mode() {
                    release_keys_if_needed(&mut prev_keys);

                    // Suspensión en kernel mediante Condvar: 0% CPU cuando no hay streaming activo
                    let (lock, cvar) = &STREAMING_FOCUS_CV;
                    if let Ok(mut state) = lock.lock() {
                        while !*state
                            && IS_LISTENER_RUNNING.load(Ordering::Relaxed)
                            && (!STREAMING_WINDOW.is_focused() || crate::streaming::is_mirror_mode())
                        {
                            match cvar.wait_timeout(state, Duration::from_millis(500)) {
                                Ok((new_state, _)) => state = new_state,
                                Err(_) => break,
                            }
                        }
                    }
                    continue;
                }

                poll_cursor_position();
                poll_keyboard_state(&mut prev_keys);
                std::thread::sleep(POLL_INTERVAL);
            }
        });
    }

    /// Si hay teclas guardadas como presionadas al perder foco, se envía liberación a Sunshine.
    fn release_keys_if_needed(prev_keys: &mut [bool; 256]) {
        let has_any_down = prev_keys.iter().any(|&down| down);
        if has_any_down {
            for vk in 1u16..=255 {
                if prev_keys[vk as usize] {
                    prev_keys[vk as usize] = false;
                    if (0x01..=0x06).contains(&vk) {
                        if let Some(btn) = vk_to_mouse_button(vk) {
                            relay_mouse_button(btn, false);
                        }
                    } else {
                        relay_keyboard_event(vk, false, 0);
                    }
                }
            }
            release_all_active_keys();
        }
    }

    /// Lee la posición del cursor usando el área cliente interna 1:1 de la ventana.
    /// Emite la posición absoluta (para escritorio) y los deltas de movimiento relativo
    /// (esenciales para juegos como League of Legends, Valorant o FPS 3D).
    fn poll_cursor_position() {
        use std::sync::Mutex;
        static LAST_CURSOR_POS: std::sync::LazyLock<Mutex<Option<(i32, i32)>>> =
            std::sync::LazyLock::new(|| Mutex::new(None));

        let hwnd =
            STREAMING_WINDOW.hwnd.load(Ordering::Relaxed) as windows_sys::Win32::Foundation::HWND;

        if hwnd.is_null() {
            return;
        }

        let mut cursor_pos = POINT { x: 0, y: 0 };
        let mut client_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };

        // SAFETY: ScreenToClient y GetClientRect obtienen las coordenadas exactas de la superficie de renderizado.
        let cursor_ok = unsafe { GetCursorPos(&mut cursor_pos) } != 0;
        let client_ok = unsafe { GetClientRect(hwnd, &mut client_rect) } != 0;
        let screen_to_client_ok = unsafe { ScreenToClient(hwnd, &mut cursor_pos) } != 0;

        if !cursor_ok || !client_ok || !screen_to_client_ok {
            return;
        }

        let width = (client_rect.right - client_rect.left) as i16;
        let height = (client_rect.bottom - client_rect.top) as i16;

        let curr_x = cursor_pos.x;
        let curr_y = cursor_pos.y;

        let mut delta_x = 0i16;
        let mut delta_y = 0i16;

        if let Ok(mut last_guard) = LAST_CURSOR_POS.lock() {
            if let Some((last_x, last_y)) = *last_guard {
                delta_x = (curr_x - last_x).clamp(-32767, 32767) as i16;
                delta_y = (curr_y - last_y).clamp(-32767, 32767) as i16;
            }
            *last_guard = Some((curr_x, curr_y));
        }

        if width > 0 && height > 0 {
            let rel_x = curr_x.clamp(0, width as i32) as i16;
            let rel_y = curr_y.clamp(0, height as i32) as i16;
            relay_mouse_position(rel_x, rel_y, width, height);

            if delta_x != 0 || delta_y != 0 {
                relay_mouse_move(delta_x, delta_y);
            }
        }
    }

    /// Escanea el estado de todas las teclas y botones del ratón, emitiendo eventos de cambio.
    fn poll_keyboard_state(prev_keys: &mut [bool; 256]) {
        let modifiers = build_modifier_flags();

        for vk in 1u16..=255 {
            // Tecla Windows (0x5B y 0x5C) es procesada por el hook WH_KEYBOARD_LL para evitar duplicación
            if vk == 0x5B || vk == 0x5C {
                continue;
            }

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
                if !STREAMING_WINDOW.is_focused() || crate::streaming::is_mirror_mode() {
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
        match key {
            // ── Letras A–Z ──
            rdev::Key::KeyA => 0x41,
            rdev::Key::KeyB => 0x42,
            rdev::Key::KeyC => 0x43,
            rdev::Key::KeyD => 0x44,
            rdev::Key::KeyE => 0x45,
            rdev::Key::KeyF => 0x46,
            rdev::Key::KeyG => 0x47,
            rdev::Key::KeyH => 0x48,
            rdev::Key::KeyI => 0x49,
            rdev::Key::KeyJ => 0x4A,
            rdev::Key::KeyK => 0x4B,
            rdev::Key::KeyL => 0x4C,
            rdev::Key::KeyM => 0x4D,
            rdev::Key::KeyN => 0x4E,
            rdev::Key::KeyO => 0x4F,
            rdev::Key::KeyP => 0x50,
            rdev::Key::KeyQ => 0x51,
            rdev::Key::KeyR => 0x52,
            rdev::Key::KeyS => 0x53,
            rdev::Key::KeyT => 0x54,
            rdev::Key::KeyU => 0x55,
            rdev::Key::KeyV => 0x56,
            rdev::Key::KeyW => 0x57,
            rdev::Key::KeyX => 0x58,
            rdev::Key::KeyY => 0x59,
            rdev::Key::KeyZ => 0x5A,

            // ── Números 0–9 ──
            rdev::Key::Num0 => 0x30,
            rdev::Key::Num1 => 0x31,
            rdev::Key::Num2 => 0x32,
            rdev::Key::Num3 => 0x33,
            rdev::Key::Num4 => 0x34,
            rdev::Key::Num5 => 0x35,
            rdev::Key::Num6 => 0x36,
            rdev::Key::Num7 => 0x37,
            rdev::Key::Num8 => 0x38,
            rdev::Key::Num9 => 0x39,

            // ── Teclas de función F1–F12 ──
            rdev::Key::F1 => 0x70,
            rdev::Key::F2 => 0x71,
            rdev::Key::F3 => 0x72,
            rdev::Key::F4 => 0x73,
            rdev::Key::F5 => 0x74,
            rdev::Key::F6 => 0x75,
            rdev::Key::F7 => 0x76,
            rdev::Key::F8 => 0x77,
            rdev::Key::F9 => 0x78,
            rdev::Key::F10 => 0x79,
            rdev::Key::F11 => 0x7A,
            rdev::Key::F12 => 0x7B,

            // ── Teclas especiales ──
            rdev::Key::Space => 0x20,
            rdev::Key::Return => 0x0D,
            rdev::Key::Escape => 0x1B,
            rdev::Key::Tab => 0x09,
            rdev::Key::Backspace => 0x08,

            // ── Modificadores ──
            rdev::Key::ShiftLeft => 0xA0,
            rdev::Key::ShiftRight => 0xA1,
            rdev::Key::ControlLeft => 0xA2,
            rdev::Key::ControlRight => 0xA3,
            rdev::Key::Alt => 0xA4,       // VK_LMENU
            rdev::Key::AltGr => 0xA5,     // VK_RMENU
            rdev::Key::MetaLeft => 0x5B,  // VK_LWIN
            rdev::Key::MetaRight => 0x5C, // VK_RWIN

            // ── Navegación ──
            rdev::Key::UpArrow => 0x26,
            rdev::Key::DownArrow => 0x28,
            rdev::Key::LeftArrow => 0x25,
            rdev::Key::RightArrow => 0x27,
            rdev::Key::Home => 0x24,
            rdev::Key::End => 0x23,
            rdev::Key::PageUp => 0x21,
            rdev::Key::PageDown => 0x22,
            rdev::Key::Insert => 0x2D,
            rdev::Key::Delete => 0x2E,

            // ── Locks ──
            rdev::Key::CapsLock => 0x14,
            rdev::Key::NumLock => 0x90,
            rdev::Key::ScrollLock => 0x91,

            // ── System ──
            rdev::Key::PrintScreen => 0x2C,
            rdev::Key::Pause => 0x13,

            // ── Numpad ──
            rdev::Key::Kp0 => 0x60,
            rdev::Key::Kp1 => 0x61,
            rdev::Key::Kp2 => 0x62,
            rdev::Key::Kp3 => 0x63,
            rdev::Key::Kp4 => 0x64,
            rdev::Key::Kp5 => 0x65,
            rdev::Key::Kp6 => 0x66,
            rdev::Key::Kp7 => 0x67,
            rdev::Key::Kp8 => 0x68,
            rdev::Key::Kp9 => 0x69,
            rdev::Key::KpMultiply => 0x6A,
            rdev::Key::KpPlus => 0x6B,
            rdev::Key::KpMinus => 0x6D,
            rdev::Key::KpDelete => 0x6E,
            rdev::Key::KpDivide => 0x6F,
            rdev::Key::KpReturn => 0x0D, // VK_RETURN (mismo que Enter principal)

            // ── Puntuación y símbolos ──
            rdev::Key::SemiColon => 0xBA,    // VK_OEM_1 ( ;: )
            rdev::Key::Equal => 0xBB,        // VK_OEM_PLUS ( =+ )
            rdev::Key::Comma => 0xBC,        // VK_OEM_COMMA ( ,< )
            rdev::Key::Minus => 0xBD,        // VK_OEM_MINUS ( -_ )
            rdev::Key::Dot => 0xBE,          // VK_OEM_PERIOD ( .> )
            rdev::Key::Slash => 0xBF,        // VK_OEM_2 ( /? )
            rdev::Key::BackQuote => 0xC0,    // VK_OEM_3 ( `~ )
            rdev::Key::LeftBracket => 0xDB,  // VK_OEM_4 ( [{ )
            rdev::Key::BackSlash => 0xDC,    // VK_OEM_5 ( \| )
            rdev::Key::RightBracket => 0xDD, // VK_OEM_6 ( ]} )
            rdev::Key::Quote => 0xDE,        // VK_OEM_7 ( '" )

            _ => 0,
        }
    }
}

/// Inicia el hilo nativo de Rust para capturar entradas físicas de Teclado y Ratón
/// cuando la ventana de streaming está enfocada.
pub fn start_native_input_listener() {
    IS_LISTENER_RUNNING.store(true, Ordering::SeqCst);
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

/// Detiene y desinstala inmediatamente los escuchadores nativos de entrada al cerrar la app o destruir la ventana.
pub fn stop_native_input_listener() {
    IS_LISTENER_RUNNING.store(false, Ordering::SeqCst);
    notify_streaming_focus_change(true);
    release_all_active_keys();
    #[cfg(target_os = "windows")]
    {
        windows_listener::stop_hooks_thread();
    }
    log::info!("[InputListener] Escuchadores nativos de entrada detenidos limpiamente");
}

/// Libera todas las teclas de teclado activas enviando eventos KEY_ACTION_UP hacia el host.
pub fn release_all_active_keys() {
    #[cfg(target_os = "windows")]
    windows_listener::release_all_active_keys();
}
