//! Relay de inputs del gamepad a Moonlight.
//!
//! Intercepta eventos raw del gamepad (Gilrs) y los traduce al formato
//! `NV_CONTROLLER_STATE` para enviarlos al host de Sunshine activo.

use crate::streaming::bindings::LiSendMultiControllerEvent;
use gilrs::{Axis, Button, EventType};
use once_cell::sync::Lazy;
use std::sync::atomic::{AtomicI16, AtomicI32, AtomicU8, Ordering};

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

/// Estado retenido del gamepad para construir la trama completa.
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
        // Gilrs usa -1.0 a 1.0. XInput usa -32768 a 32767
        let mapped = (value * 32767.0).clamp(-32768.0, 32767.0) as i16;

        match axis {
            Axis::LeftStickX => self.left_stick_x.store(mapped, Ordering::Relaxed),
            Axis::LeftStickY => self.left_stick_y.store(mapped, Ordering::Relaxed), // NV invierte la Y o XInput? NV usa XInput.
            Axis::RightStickX => self.right_stick_x.store(mapped, Ordering::Relaxed),
            Axis::RightStickY => self.right_stick_y.store(mapped, Ordering::Relaxed),
            _ => {}
        }
    }

    fn update_trigger(&self, axis: Axis, value: f32) {
        // Triggers van de 0.0 a 1.0 en XInput, NV espera 0 a 255
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
                1 << player_id, // activeGamepadMask
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

// Para soportar hasta 4 jugadores locales enviando al host
static GAMEPADS: Lazy<[ControllerState; 4]> = Lazy::new(|| {
    [
        ControllerState::new(),
        ControllerState::new(),
        ControllerState::new(),
        ControllerState::new(),
    ]
});

/// Punto de entrada desde el bucle principal de gilrs.
/// Actualiza el estado y envía la trama al host.
pub fn relay_event(player_id: usize, event: &EventType) {
    if player_id >= 4 {
        return;
    }

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
        // ButtonChanged se usa para triggers analógicos a veces si están mapeados como botones
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
