//! Relay nativo de entradas (Gamepad, Teclado y Mouse) hacia Moonlight-C.
//!
//! Intercepta eventos nativos del sistema en Rust y los transmite directamente
//! al host de Sunshine activo con latencia sub-milisegundo.

use crate::streaming::bindings::*;
use gilrs::{Axis, Button, EventType};
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicBool, AtomicI16, AtomicI32, AtomicU8, Ordering};

// Banderas de botones XInput estándar que usa NV_CONTROLLER_STATE
const BUTTON_UP: i32 = 0x0001;
const BUTTON_DOWN: i32 = 0x0002;
const BUTTON_LEFT: i32 = 0x0004;
const BUTTON_RIGHT: i32 = 0x0008;
const BUTTON_START: i32 = 0x0010;
const BUTTON_BACK: i32 = 0x0020;
const BUTTON_LS: i32 = 0x0040;
const BUTTON_RS: i32 = 0x0080;
const BUTTON_LB: i32 = 0x0100;
const BUTTON_RB: i32 = 0x0200;
const BUTTON_GUIDE: i32 = 0x0400;
const BUTTON_A: i32 = 0x1000;
const BUTTON_B: i32 = 0x2000;
const BUTTON_X: i32 = 0x4000;
const BUTTON_Y: i32 = 0x8000;

/// Estado retenido del gamepad para construir la trama completa de XInput.
struct ControllerState {
    buttons: AtomicI32,
    left_trigger: AtomicU8,
    right_trigger: AtomicU8,
    left_stick_x: AtomicI16,
    left_stick_y: AtomicI16,
    right_stick_x: AtomicI16,
    right_stick_y: AtomicI16,
}

impl ControllerState {
    const fn new() -> Self {
        Self {
            buttons: AtomicI32::new(0),
            left_trigger: AtomicU8::new(0),
            right_trigger: AtomicU8::new(0),
            left_stick_x: AtomicI16::new(0),
            left_stick_y: AtomicI16::new(0),
            right_stick_x: AtomicI16::new(0),
            right_stick_y: AtomicI16::new(0),
        }
    }

    fn update_button(&self, button: Button, pressed: bool) {
        let flag = match button {
            Button::South => BUTTON_A,
            Button::East => BUTTON_B,
            Button::West => BUTTON_X,
            Button::North => BUTTON_Y,
            Button::DPadUp => BUTTON_UP,
            Button::DPadDown => BUTTON_DOWN,
            Button::DPadLeft => BUTTON_LEFT,
            Button::DPadRight => BUTTON_RIGHT,
            Button::Start => BUTTON_START,
            Button::Select => BUTTON_BACK,
            Button::LeftTrigger => BUTTON_LB,
            Button::RightTrigger => BUTTON_RB,
            Button::LeftThumb => BUTTON_LS,
            Button::RightThumb => BUTTON_RS,
            Button::Mode => BUTTON_GUIDE,
            _ => 0,
        };

        if flag != 0 {
            if pressed {
                self.buttons.fetch_or(flag, Ordering::Relaxed);
            } else {
                self.buttons.fetch_and(!flag, Ordering::Relaxed);
            }
        }
    }

    fn update_axis(&self, axis: Axis, value: f32) {
        let mapped = (value * 32767.0).clamp(-32768.0, 32767.0) as i16;
        match axis {
            Axis::LeftStickX => self.left_stick_x.store(mapped, Ordering::Relaxed),
            Axis::LeftStickY => self.left_stick_y.store(mapped, Ordering::Relaxed),
            Axis::RightStickX => self.right_stick_x.store(mapped, Ordering::Relaxed),
            Axis::RightStickY => self.right_stick_y.store(mapped, Ordering::Relaxed),
            _ => {}
        }
    }

    fn update_trigger(&self, axis: Axis, value: f32) {
        let mapped = (value * 255.0).clamp(0.0, 255.0) as u8;
        match axis {
            Axis::LeftZ => self.left_trigger.store(mapped, Ordering::Relaxed),
            Axis::RightZ => self.right_trigger.store(mapped, Ordering::Relaxed),
            _ => {}
        }
    }

    fn send(&self, player_id: i16) {
        unsafe {
            LiSendMultiControllerEvent(
                player_id,
                1 << player_id,
                self.buttons.load(Ordering::Relaxed),
                self.left_trigger.load(Ordering::Relaxed),
                self.right_trigger.load(Ordering::Relaxed),
                self.left_stick_x.load(Ordering::Relaxed),
                self.left_stick_y.load(Ordering::Relaxed),
                self.right_stick_x.load(Ordering::Relaxed),
                self.right_stick_y.load(Ordering::Relaxed),
            );
        }
    }
}

static GAMEPADS: Lazy<[ControllerState; 4]> = Lazy::new(|| {
    [
        ControllerState::new(),
        ControllerState::new(),
        ControllerState::new(),
        ControllerState::new(),
    ]
});

static REGISTERED_GAMEPADS: Lazy<[AtomicBool; 4]> = Lazy::new(|| {
    [
        AtomicBool::new(false),
        AtomicBool::new(false),
        AtomicBool::new(false),
        AtomicBool::new(false),
    ]
});

/// Registra oficialmente la presencia de un mando virtual en Sunshine Host si no se ha notificado aún.
pub fn register_controller_arrival(player_id: usize) {
    if player_id >= 4 {
        return;
    }

    if !REGISTERED_GAMEPADS[player_id].swap(true, Ordering::Relaxed) {
        let mask = (1u16 << player_id) | 1u16;
        let supported_buttons: u32 = 0xFFFF;
        let capabilities = LI_CCAP_ANALOG_TRIGGERS | LI_CCAP_RUMBLE;
        send_controller_arrival_event(
            player_id as u8,
            mask,
            LI_CTYPE_XBOX,
            supported_buttons,
            capabilities,
        );
        log::info!(
            "[InputRelay] Mando virtual #{} registrado en Sunshine Host",
            player_id
        );
    }
}

/// Transmite un evento de mando desde Gilrs hacia el Host.
pub fn relay_event(player_id: usize, event: &EventType) {
    if player_id >= 4 {
        return;
    }

    register_controller_arrival(player_id);
    let state = &GAMEPADS[player_id];
    let mut changed = false;

    match event {
        EventType::ButtonPressed(btn, _) => {
            state.update_button(*btn, true);
            changed = true;
        }
        EventType::ButtonReleased(btn, _) => {
            state.update_button(*btn, false);
            changed = true;
        }
        EventType::AxisChanged(axis, val, _) => {
            if *axis == Axis::LeftZ || *axis == Axis::RightZ {
                state.update_trigger(*axis, *val);
            } else {
                state.update_axis(*axis, *val);
            }
            changed = true;
        }
        EventType::ButtonChanged(btn, val, _) => {
            if *btn == Button::LeftTrigger2 {
                state.update_trigger(Axis::LeftZ, *val);
                changed = true;
            } else if *btn == Button::RightTrigger2 {
                state.update_trigger(Axis::RightZ, *val);
                changed = true;
            }
        }
        _ => {}
    }

    if changed {
        state.send(player_id as i16);
    }
}

/// Transmite un evento de teclado hacia el Host.
pub fn relay_keyboard_event(vk_code: u16, is_down: bool, modifiers: u8) {
    let action = if is_down {
        KEY_ACTION_DOWN
    } else {
        KEY_ACTION_UP
    };
    send_keyboard_event(vk_code as i16, action, modifiers as i8);
}

/// Transmite un movimiento relativo de ratón (ideal para FPS / Juegos 3D).
pub fn relay_mouse_move(delta_x: i16, delta_y: i16) {
    send_mouse_move_event(delta_x, delta_y);
}

/// Transmite una pulsación o liberación de botón de ratón.
pub fn relay_mouse_button(button: u8, is_down: bool) {
    let action = if is_down {
        BUTTON_ACTION_PRESS
    } else {
        BUTTON_ACTION_RELEASE
    };
    let btn_code = match button {
        1 => MOUSE_BUTTON_LEFT,
        2 => MOUSE_BUTTON_MIDDLE,
        3 => MOUSE_BUTTON_RIGHT,
        4 => MOUSE_BUTTON_X1,
        5 => MOUSE_BUTTON_X2,
        _ => return,
    };
    send_mouse_button_event(action, btn_code);
}
