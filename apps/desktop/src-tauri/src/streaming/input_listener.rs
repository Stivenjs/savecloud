//! Escucha nativa multiplataforma de eventos de teclado y ratón directamente en Rust.
//!
//! Intercepta eventos físicos de hardware (Windows, macOS, Linux) en un hilo nativo de Rust
//! y los enruta directamente al módulo `input_relay` hacia el host Sunshine sin involucrar JavaScript.

use super::input_relay::*;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Window, WindowEvent};

/// Estado del foco de la ventana de streaming ("streaming-window").
pub static STREAMING_WINDOW_FOCUSED: AtomicBool = AtomicBool::new(false);

/// Registra los eventos de foco y destrucción de la ventana de streaming ("streaming-window").
pub fn handle_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "streaming-window" {
        return;
    }

    match event {
        WindowEvent::Focused(focused) => {
            STREAMING_WINDOW_FOCUSED.store(*focused, Ordering::Relaxed);
            log::info!("[InputListener] Foco de ventana de streaming: {}", focused);
        }
        WindowEvent::Destroyed => {
            STREAMING_WINDOW_FOCUSED.store(false, Ordering::Relaxed);
            log::info!("[InputListener] Ventana de streaming destruida");
        }
        _ => {}
    }
}

/// Inicia el hilo nativo de Rust para capturar entradas físicas de Teclado y Ratón cuando la ventana está enfocada.
pub fn start_native_input_listener() {
    #[cfg(target_os = "windows")]
    {
        std::thread::spawn(move || {
            use windows_sys::Win32::Foundation::POINT;
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
            use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

            let mut prev_keys = [false; 256];
            let mut last_cursor = POINT { x: 0, y: 0 };
            let mut has_cursor = false;

            loop {
                if STREAMING_WINDOW_FOCUSED.load(Ordering::Relaxed) {
                    let mut current_pos = POINT { x: 0, y: 0 };
                    if unsafe { GetCursorPos(&mut current_pos) } != 0 {
                        if has_cursor {
                            let delta_x = (current_pos.x - last_cursor.x) as i16;
                            let delta_y = (current_pos.y - last_cursor.y) as i16;
                            if delta_x != 0 || delta_y != 0 {
                                relay_mouse_move(delta_x, delta_y);
                            }
                        } else {
                            has_cursor = true;
                        }
                        last_cursor = current_pos;
                    }

                    for vk in 1..=255u16 {
                        let state = unsafe { GetAsyncKeyState(vk as i32) };
                        let is_down = (state as u16 & 0x8000) != 0;

                        if is_down != prev_keys[vk as usize] {
                            prev_keys[vk as usize] = is_down;

                            if vk >= 0x01 && vk <= 0x06 {
                                let btn = match vk {
                                    0x01 => 1, // Izquierdo
                                    0x04 => 2, // Central
                                    0x02 => 3, // Derecho
                                    0x05 => 4, // X1
                                    0x06 => 5, // X2
                                    _ => 0,
                                };
                                if btn != 0 {
                                    relay_mouse_button(btn, is_down);
                                }
                            } else {
                                relay_keyboard_event(vk, is_down, 0);
                            }
                        }
                    }
                } else {
                    prev_keys.fill(false);
                    has_cursor = false;
                }

                std::thread::sleep(std::time::Duration::from_millis(4));
            }
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        std::thread::spawn(move || {
            log::info!(
                "[InputListener] Hilo nativo rdev de captura inicializado en POSIX (macOS/Linux)"
            );

            let mut last_x = 0.0;
            let mut last_y = 0.0;
            let mut has_mouse = false;

            if let Err(error) = rdev::listen(move |event: rdev::Event| {
                if !STREAMING_WINDOW_FOCUSED.load(Ordering::Relaxed) {
                    has_mouse = false;
                    return;
                }

                match event.event_type {
                    rdev::EventType::KeyPress(key) => {
                        let vk = map_rdev_key_to_vk(key);
                        if vk != 0 {
                            relay_keyboard_event(vk, true, 0);
                        }
                    }
                    rdev::EventType::KeyRelease(key) => {
                        let vk = map_rdev_key_to_vk(key);
                        if vk != 0 {
                            relay_keyboard_event(vk, false, 0);
                        }
                    }
                    rdev::EventType::MouseMove { x, y } => {
                        if has_mouse {
                            let delta_x = (x - last_x) as i16;
                            let delta_y = (y - last_y) as i16;
                            if delta_x != 0 || delta_y != 0 {
                                relay_mouse_move(delta_x, delta_y);
                            }
                        } else {
                            has_mouse = true;
                        }
                        last_x = x;
                        last_y = y;
                    }
                    rdev::EventType::ButtonPress(button) => {
                        let btn = match button {
                            rdev::Button::Left => 1,
                            rdev::Button::Middle => 2,
                            rdev::Button::Right => 3,
                            rdev::Button::Unknown(4) => 4,
                            rdev::Button::Unknown(5) => 5,
                            _ => 0,
                        };
                        if btn != 0 {
                            relay_mouse_button(btn, true);
                        }
                    }
                    rdev::EventType::ButtonRelease(button) => {
                        let btn = match button {
                            rdev::Button::Left => 1,
                            rdev::Button::Middle => 2,
                            rdev::Button::Right => 3,
                            rdev::Button::Unknown(4) => 4,
                            rdev::Button::Unknown(5) => 5,
                            _ => 0,
                        };
                        if btn != 0 {
                            relay_mouse_button(btn, false);
                        }
                    }
                    _ => {}
                }
            }) {
                log::error!("[InputListener] Error en escuchador rdev: {:?}", error);
            }
        });
    }
}

/// Mapea las teclas rdev de POSIX (macOS / Linux) a códigos Win32 Virtual Key (VK) para Sunshine.
#[cfg(not(target_os = "windows"))]
fn map_rdev_key_to_vk(key: rdev::Key) -> u16 {
    use rdev::Key::*;
    match key {
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
        Space => 0x20,
        Return => 0x0D,
        Escape => 0x1B,
        Tab => 0x09,
        BackSpace => 0x08,
        ShiftLeft => 0xA0,
        ShiftRight => 0xA1,
        ControlLeft => 0xA2,
        ControlRight => 0xA3,
        Alt => 0x12,
        AltGr => 0x12,
        MetaLeft => 0x5B,
        MetaRight => 0x5C,
        UpArrow => 0x26,
        DownArrow => 0x28,
        LeftArrow => 0x25,
        RightArrow => 0x27,
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
        _ => 0,
    }
}
