//! Gilrs+XInput no procesa **`Button::Mode`**. Para el Xbox Guide falta usar la API extendida XInput:
//! **`XInputGetState`** (documentada) históricamente **no rellena** el bit **`XINPUT_GAMEPAD_GUIDE`**
//! en apps; **`XInputGetStateEx`** (ordinal 100 en `xinput1_*.dll`),
//! `rusty_xinput::XInputHandle::get_state_ex`, sí lo hace cuando el DLL lo ofrece.
//!
//! Detectamos pulsación con **`get_state_ex`**, actualizamos `LIVE_GUIDE` y reinyectamos en gilrs con
//! `Gilrs::insert_event`, para seguir usando el mismo `match` (`mapper`, `InputState`,
//! `controller_action`).

use std::sync::{Mutex, PoisonError};

use gilrs::ev::Code;
use gilrs::{Button, Event, EventType, GamepadId, Gilrs};
use once_cell::sync::Lazy;
use rusty_xinput::{XInputHandle, XInputUsageError, XINPUT_GAMEPAD_GUIDE};

static XINPUT_HANDLE: Lazy<Option<XInputHandle>> =
    Lazy::new(|| match XInputHandle::load_default() {
        Ok(h) => Some(h),
        Err(e) => {
            log::debug!(
                "[xinput_guide] XInput no cargó (Guide no disponible): {:?}",
                e
            );
            None
        }
    });

static LAST_GUIDE: Mutex<[bool; 4]> = Mutex::new([false; 4]);
static LIVE_GUIDE: Mutex<[bool; 4]> = Mutex::new([false; 4]);

#[inline]
fn lock_buttons(m: &Mutex<[bool; 4]>) -> std::sync::MutexGuard<'_, [bool; 4]> {
    m.lock().unwrap_or_else(PoisonError::into_inner)
}

fn read_guide_buttons() -> [bool; 4] {
    let mut out = [false; 4];
    let Some(handle) = XINPUT_HANDLE.as_ref() else {
        return out;
    };
    for idx in 0..4_u32 {
        match handle.get_state_ex(idx) {
            Ok(state) => {
                out[idx as usize] = state.raw.Gamepad.wButtons & XINPUT_GAMEPAD_GUIDE != 0;
            }
            Err(XInputUsageError::DeviceNotConnected) => {}
            Err(XInputUsageError::XInputNotLoaded) => {
                log::debug!(
                    "[xinput_guide] XInputGetStateEx ausente en este DLL; Guide Xbox no será leído"
                );
                break;
            }
            Err(e) => {
                log::debug!("[xinput_guide] get_state_ex slot {}: {:?}", idx, e);
            }
        }
    }
    out
}

/// Alineado con [`inject_guide_synthetic_events`] pero sin meter eventos (tras perder foco).
pub fn sync_after_unfocused() {
    let cur = read_guide_buttons();
    *lock_buttons(&LAST_GUIDE) = cur;
    *lock_buttons(&LIVE_GUIDE) = cur;
}

/// `GamepadId` sólo llega desde [`Gilrs::gamepads`].
fn guide_inject_slots(gilrs: &Gilrs) -> Vec<(usize, GamepadId, Code)> {
    gilrs
        .gamepads()
        .filter(|(gid, gp)| usize::from(*gid) < 4 && gp.is_connected())
        .filter_map(|(gid, gp)| {
            gp.button_code(Button::Mode)
                .or_else(|| Button::Mode.to_nec())
                .map(|code| (usize::from(gid), gid, code))
        })
        .collect()
}

/// Coloca eventos de `Mode` en la cola de gilrs **antes** del `while gilrs.next_event()` del mismo
/// ciclo.
pub fn inject_guide_synthetic_events(gilrs: &mut Gilrs) {
    let cur = read_guide_buttons();
    *lock_buttons(&LIVE_GUIDE) = cur;

    let slots = guide_inject_slots(gilrs);
    let mut last = lock_buttons(&LAST_GUIDE);

    for slot in 0..4 {
        if cur[slot] == last[slot] {
            continue;
        }
        if let Some(&(_, gid, code)) = slots.iter().find(|(s, _, _)| *s == slot) {
            let event_type = if cur[slot] {
                EventType::ButtonPressed(Button::Mode, code)
            } else {
                EventType::ButtonReleased(Button::Mode, code)
            };
            gilrs.insert_event(Event::new(gid, event_type));
        }
        last[slot] = cur[slot];
    }
}

pub(crate) fn is_guide_pressed(slot: usize) -> bool {
    slot < 4 && lock_buttons(&LIVE_GUIDE)[slot]
}
