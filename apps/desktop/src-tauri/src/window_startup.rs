//! Ajuste de la ventana principal al arranque (modo Big Picture = pantalla completa).

use tauri::{App, Manager};

use crate::config;

/// Aplica pantalla completa a la ventana `main` según `startup_window_mode` y el atajo de arranque.
///
/// Si el usuario mantiene pulsado **Shift, Alt, Ctrl o Cmd** al iniciar, se ignora Big Picture una sola vez
/// (la preferencia en disco no cambia). En Linux no hay detección fiable de teclas antes del foco: solo se aplica la preferencia.
pub fn apply_main_window_launch_window_state(app: &App) -> Result<(), Box<dyn std::error::Error>> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let settings = config::load_settings();
    let mode = settings
        .startup_window_mode
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("normal");

    let want_big_picture = mode.eq_ignore_ascii_case("big_picture");
    let suppress = startup_big_picture_suppressed_by_modifier();
    let fullscreen = want_big_picture && !suppress;

    let _ = window.set_fullscreen(fullscreen);
    Ok(())
}

fn startup_big_picture_suppressed_by_modifier() -> bool {
    #[cfg(target_os = "windows")]
    {
        return windows_modifiers_down();
    }
    #[cfg(target_os = "macos")]
    {
        return macos_modifiers_down();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        false
    }
}

#[cfg(target_os = "windows")]
fn windows_modifiers_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;

    const VK_SHIFT: i32 = 0x10;
    const VK_CONTROL: i32 = 0x11;
    const VK_MENU: i32 = 0x12;

    unsafe {
        let down = |vk: i32| (GetAsyncKeyState(vk) as u16 & 0x8000) != 0;
        down(VK_SHIFT) || down(VK_CONTROL) || down(VK_MENU)
    }
}

#[cfg(target_os = "macos")]
fn macos_modifiers_down() -> bool {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceFlagsState(state_id: u32) -> u64;
    }

    const kCGEventSourceStateCombinedSessionState: u32 = 1;
    const kCGEventFlagMaskShift: u64 = 0x020_000;
    const kCGEventFlagMaskControl: u64 = 0x040_000;
    const kCGEventFlagMaskAlternate: u64 = 0x080_000;
    const kCGEventFlagMaskCommand: u64 = 0x100_000;

    let mask = kCGEventFlagMaskShift
        | kCGEventFlagMaskControl
        | kCGEventFlagMaskAlternate
        | kCGEventFlagMaskCommand;

    unsafe {
        let flags = CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
        (flags & mask) != 0
    }
}
