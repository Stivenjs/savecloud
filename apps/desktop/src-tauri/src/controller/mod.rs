//! Módulo de control de Gamepad.
//!
//! Contiene las estructuras de datos y funciones para:
//!
//! - Iniciar el bucle de eventos del Gamepad.
//! - Emitir las acciones del Gamepad.
//! - Manejar los eventos del Gamepad.
//! - Manejar los estados del Gamepad.
//! - Manejar las repeticiones de las acciones del Gamepad.

pub mod actions;
pub mod mapper;
pub mod state;

use actions::{ControllerEvent, SemanticAction};
use gilrs::{Event as GilrsEvent, EventType, Gilrs};
use state::InputState;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn start_gamepad_loop(app_handle: AppHandle) {
    thread::spawn(move || {
        let mut gilrs = match Gilrs::new() {
            Ok(g) => g,
            Err(_) => return,
        };
        let mut input_state = InputState::new();

        loop {
            let is_focused = app_handle
                .get_webview_window("main")
                .and_then(|w| w.is_focused().ok())
                .unwrap_or(false);

            if !is_focused {
                input_state.clear();
            }

            while let Some(GilrsEvent { id, event, .. }) = gilrs.next_event() {
                // siempre debemos sacar los eventos de gilrs para vaciar su cola,
                // pero si la ventana no tiene el foco, simplemente los ignoramos.
                if !is_focused {
                    continue;
                }

                let player_id = id.into();

                match event {
                    EventType::ButtonPressed(button, _) => {
                        if let Some(action) = mapper::map_button(button) {
                            if input_state.press(player_id, action) {
                                emit_action(&app_handle, player_id, action);
                            }
                        }
                    }
                    EventType::ButtonReleased(button, _) => {
                        if let Some(action) = mapper::map_button(button) {
                            input_state.release(player_id, action);
                        }
                    }
                    EventType::AxisChanged(axis, value, _) => {
                        for a in [
                            SemanticAction::NavigateUp,
                            SemanticAction::NavigateDown,
                            SemanticAction::NavigateLeft,
                            SemanticAction::NavigateRight,
                        ] {
                            input_state.release(player_id, a);
                        }

                        if let Some(action) = mapper::map_axis(axis, value) {
                            if input_state.press(player_id, action) {
                                emit_action(&app_handle, player_id, action);
                            }
                        }
                    }
                    EventType::ButtonRepeated(_, _) | EventType::ButtonChanged(_, _, _) => {}
                    EventType::Dropped => {}
                    EventType::Connected | EventType::Disconnected => {}
                }
            }

            // Solo emitimos las repeticiones continuas si la ventana está activa
            if is_focused {
                for (player_id, action) in input_state.get_repeats() {
                    emit_action(&app_handle, player_id, action);
                }
            }

            gilrs.inc();
            thread::sleep(Duration::from_millis(10));
        }
    });
}

fn emit_action(app: &AppHandle, player: usize, action: SemanticAction) {
    let payload = ControllerEvent { action, player };
    let _ = app.emit("controller_action", payload);
}
