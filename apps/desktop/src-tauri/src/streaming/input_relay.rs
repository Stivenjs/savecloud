//! Relay nativo de entradas (Gamepad, Teclado y Mouse) hacia Moonlight-C.
//!
//! Intercepta eventos nativos del sistema en Rust y los transmite directamente
//! al host de Sunshine activo con latencia sub-milisegundo.
//!
//! ## Arquitectura
//!
//! El módulo se divide en tres dominios de entrada:
//! - **Gamepad** — Estado XInput completo (botones, ejes, triggers) vía `gilrs`.
//! - **Teclado** — Eventos key-down/key-up con flags de modificadores.
//! - **Mouse** — Posición absoluta, movimiento relativo, botones y scroll.

use std::sync::atomic::{AtomicBool, AtomicI16, AtomicI32, AtomicU8, Ordering};
use std::sync::LazyLock;

use gilrs::{Axis, Button, EventType};

use crate::streaming::bindings::{
    send_controller_arrival_event, send_keyboard_event, send_mouse_button_event,
    send_mouse_move_event, send_mouse_position_event, send_scroll_event, LiSendHighResScrollEvent,
    BUTTON_ACTION_PRESS, BUTTON_ACTION_RELEASE, KEY_ACTION_DOWN, KEY_ACTION_UP,
    LI_CCAP_ANALOG_TRIGGERS, LI_CCAP_RUMBLE, LI_CTYPE_XBOX, MOUSE_BUTTON_LEFT, MOUSE_BUTTON_MIDDLE,
    MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_X1, MOUSE_BUTTON_X2,
};

// Constantes XInput (NV_CONTROLLER_STATE flags)

const XINPUT_DPAD_UP: i32 = 0x0001;
const XINPUT_DPAD_DOWN: i32 = 0x0002;
const XINPUT_DPAD_LEFT: i32 = 0x0004;
const XINPUT_DPAD_RIGHT: i32 = 0x0008;
const XINPUT_START: i32 = 0x0010;
const XINPUT_BACK: i32 = 0x0020;
const XINPUT_LEFT_THUMB: i32 = 0x0040;
const XINPUT_RIGHT_THUMB: i32 = 0x0080;
const XINPUT_LEFT_SHOULDER: i32 = 0x0100;
const XINPUT_RIGHT_SHOULDER: i32 = 0x0200;
const XINPUT_GUIDE: i32 = 0x0400;
const XINPUT_A: i32 = 0x1000;
const XINPUT_B: i32 = 0x2000;
const XINPUT_X: i32 = 0x4000;
const XINPUT_Y: i32 = 0x8000;

/// Capacidad máxima de mandos simultáneos soportados por Sunshine/Moonlight.
const MAX_GAMEPADS: usize = 4;

/// Identificador tipado de botón de ratón, evita magic numbers dispersos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MouseButton {
    Left = 1,
    Middle = 2,
    Right = 3,
    X1 = 4,
    X2 = 5,
}

impl MouseButton {
    /// Intenta construir un `MouseButton` a partir de un índice numérico (1–5).
    #[expect(dead_code, reason = "API pública para uso externo futuro")]
    pub const fn from_index(index: u8) -> Option<Self> {
        match index {
            1 => Some(Self::Left),
            2 => Some(Self::Middle),
            3 => Some(Self::Right),
            4 => Some(Self::X1),
            5 => Some(Self::X2),
            _ => None,
        }
    }

    /// Mapea al código Moonlight/Limelight correspondiente.
    const fn to_moonlight_code(self) -> i32 {
        match self {
            Self::Left => MOUSE_BUTTON_LEFT,
            Self::Middle => MOUSE_BUTTON_MIDDLE,
            Self::Right => MOUSE_BUTTON_RIGHT,
            Self::X1 => MOUSE_BUTTON_X1,
            Self::X2 => MOUSE_BUTTON_X2,
        }
    }
}

/// Estado retenido del gamepad para construir la trama completa de XInput.
///
/// Cada campo es atómico para permitir escritura desde el hilo de eventos
/// y lectura desde el hilo de envío sin locks.
///
/// # Ordenamiento de memoria
///
/// Se usa `Ordering::Relaxed` porque cada campo se actualiza de forma
/// independiente y el protocolo Moonlight tolera lecturas ligeramente
/// desactualizadas entre campos — la trama se reenvía en el siguiente tick.
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

    /// Actualiza un flag de botón digital (set/clear).
    fn update_button(&self, button: Button, pressed: bool) {
        let flag = match button {
            Button::South => XINPUT_A,
            Button::East => XINPUT_B,
            Button::West => XINPUT_X,
            Button::North => XINPUT_Y,
            Button::DPadUp => XINPUT_DPAD_UP,
            Button::DPadDown => XINPUT_DPAD_DOWN,
            Button::DPadLeft => XINPUT_DPAD_LEFT,
            Button::DPadRight => XINPUT_DPAD_RIGHT,
            Button::Start => XINPUT_START,
            Button::Select => XINPUT_BACK,
            Button::LeftTrigger => XINPUT_LEFT_SHOULDER,
            Button::RightTrigger => XINPUT_RIGHT_SHOULDER,
            Button::LeftThumb => XINPUT_LEFT_THUMB,
            Button::RightThumb => XINPUT_RIGHT_THUMB,
            Button::Mode => XINPUT_GUIDE,
            _ => return,
        };

        if pressed {
            self.buttons.fetch_or(flag, Ordering::Relaxed);
        } else {
            self.buttons.fetch_and(!flag, Ordering::Relaxed);
        }
    }

    /// Actualiza un eje analógico (sticks).
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

    /// Actualiza un trigger analógico (LT/RT).
    fn update_trigger(&self, axis: Axis, value: f32) {
        let mapped = (value * 255.0).clamp(0.0, 255.0) as u8;
        match axis {
            Axis::LeftZ => self.left_trigger.store(mapped, Ordering::Relaxed),
            Axis::RightZ => self.right_trigger.store(mapped, Ordering::Relaxed),
            _ => {}
        }
    }

    /// Envía la trama completa del estado actual al host Sunshine.
    fn send(&self, player_id: i16) {
        // SAFETY: LiSendMultiControllerEvent es thread-safe según la API de moonlight-common-c.
        unsafe {
            crate::streaming::bindings::LiSendMultiControllerEvent(
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

    /// Resetea el estado atómico del controlador a valores iniciales.
    fn reset(&self) {
        self.buttons.store(0, Ordering::Relaxed);
        self.left_trigger.store(0, Ordering::Relaxed);
        self.right_trigger.store(0, Ordering::Relaxed);
        self.left_stick_x.store(0, Ordering::Relaxed);
        self.left_stick_y.store(0, Ordering::Relaxed);
        self.right_stick_x.store(0, Ordering::Relaxed);
        self.right_stick_y.store(0, Ordering::Relaxed);
    }
}

static GAMEPADS: LazyLock<[ControllerState; MAX_GAMEPADS]> = LazyLock::new(|| {
    [
        ControllerState::new(),
        ControllerState::new(),
        ControllerState::new(),
        ControllerState::new(),
    ]
});

static REGISTERED_GAMEPADS: LazyLock<[AtomicBool; MAX_GAMEPADS]> = LazyLock::new(|| {
    [
        AtomicBool::new(false),
        AtomicBool::new(false),
        AtomicBool::new(false),
        AtomicBool::new(false),
    ]
});

/// Resetea todo el estado retenido de controladores (para nuevas conexiones / re-conexiones).
pub fn reset_input_relay_state() {
    for registered in REGISTERED_GAMEPADS.iter() {
        registered.store(false, Ordering::Relaxed);
    }
    for gamepad in GAMEPADS.iter() {
        gamepad.reset();
    }
    log::info!("[InputRelay] Estado de gamepads reseteado para nueva sesión");
}

/// Registra la presencia de un mando virtual en Sunshine Host si no se ha notificado aún.
pub fn register_controller_arrival(player_id: usize) {
    if player_id >= MAX_GAMEPADS {
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
///
/// Se recibe por referencia porque el call-site reutiliza `evt` después.
pub fn relay_event(player_id: usize, event: &EventType) {
    if player_id >= MAX_GAMEPADS {
        return;
    }

    register_controller_arrival(player_id);
    let state = &GAMEPADS[player_id];
    let mut changed = false;

    match *event {
        EventType::ButtonPressed(btn, _) => {
            state.update_button(btn, true);
            changed = true;
        }
        EventType::ButtonReleased(btn, _) => {
            state.update_button(btn, false);
            changed = true;
        }
        EventType::AxisChanged(axis, val, _) => {
            if axis == Axis::LeftZ || axis == Axis::RightZ {
                state.update_trigger(axis, val);
            } else {
                state.update_axis(axis, val);
            }
            changed = true;
        }
        EventType::ButtonChanged(btn, val, _) => {
            if btn == Button::LeftTrigger2 {
                state.update_trigger(Axis::LeftZ, val);
                changed = true;
            } else if btn == Button::RightTrigger2 {
                state.update_trigger(Axis::RightZ, val);
                changed = true;
            }
        }
        _ => {}
    }

    if changed {
        state.send(player_id as i16);
    }
}

/// Transmite un evento de teclado hacia el Host con flags de modificadores.
///
/// `modifiers` se construye con las constantes `MODIFIER_*` de bindings
/// (Shift=0x01, Ctrl=0x02, Alt=0x04, Meta=0x08).
#[inline]
pub fn relay_keyboard_event(vk_code: u16, is_down: bool, modifiers: u8) {
    let action = if is_down {
        KEY_ACTION_DOWN
    } else {
        KEY_ACTION_UP
    };
    send_keyboard_event(vk_code as i16, action, modifiers as i8);
}

/// Transmite un movimiento relativo de ratón (ideal para FPS / Juegos 3D).
#[expect(
    dead_code,
    reason = "Reservado para modo de captura relativa del ratón"
)]
#[inline]
pub fn relay_mouse_move(delta_x: i16, delta_y: i16) {
    send_mouse_move_event(delta_x, delta_y);
}

/// Transmite la posición absoluta 1:1 del ratón en la superficie de la ventana.
///
/// Modo Escritorio: sin desfasamiento, mapeo directo a coordenadas del host.
#[inline]
pub fn relay_mouse_position(x: i16, y: i16, width: i16, height: i16) {
    send_mouse_position_event(x, y, width, height);
}

/// Transmite una pulsación o liberación de botón de ratón tipado.
#[inline]
pub fn relay_mouse_button(button: MouseButton, is_down: bool) {
    let action = if is_down {
        BUTTON_ACTION_PRESS
    } else {
        BUTTON_ACTION_RELEASE
    };
    send_mouse_button_event(action, button.to_moonlight_code());
}

/// Transmite evento de rueda de desplazamiento del ratón (resolución estándar, ±1 click).
#[inline]
pub fn relay_scroll(clicks: i8) {
    send_scroll_event(clicks);
}

/// Transmite evento de rueda de desplazamiento de alta resolución (precisión sub-click).
///
/// Usa `LiSendHighResScrollEvent` para scroll suave en dispositivos que lo soporten
/// (trackpads, ruedas de alta resolución).
#[expect(
    dead_code,
    reason = "Reservado para scroll de alta resolución en POSIX"
)]
#[inline]
pub fn relay_high_res_scroll(amount: i16) {
    // SAFETY: LiSendHighResScrollEvent es thread-safe según la API de moonlight-common-c.
    unsafe {
        LiSendHighResScrollEvent(amount);
    }
}
