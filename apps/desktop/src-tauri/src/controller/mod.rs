//! Módulo de control de Gamepad.
//!
//! Contiene las estructuras de datos y funciones para:
//!
//! - Iniciar el bucle de eventos del Gamepad.
//! - Emitir las acciones del Gamepad.
//! - Manejar los eventos del Gamepad.
//! - Manejar los estados del Gamepad.
//! - Manejar las repeticiones de las acciones del Gamepad.
//! - Listado y telemetría opcional para Ajustes (ver `tester`).

pub mod actions;
pub mod driver_installer;
pub mod mapper;
pub mod state;
pub mod tester;
pub mod tester_ipc;

use actions::{ControllerEvent, SemanticAction};
use gilrs::{Event as GilrsEvent, EventType, Gilrs};
use state::InputState;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

pub fn start_gamepad_loop(app_handle: AppHandle) {
    let ff_rx = tester::init_gamepad_ff_channel();

    thread::spawn(move || {
        let mut gilrs = match Gilrs::new() {
            Ok(g) => g,
            Err(_) => return,
        };

        tester::sync_gamepad_list_cache_emit(&app_handle, &gilrs);

        let mut input_state = InputState::new();
        let mut last_telemetry_emit = Instant::now() - Duration::from_secs(1);

        loop {
            let focused = tester::relevant_app_focus(&app_handle);

            tester::drain_ff_queue(&mut gilrs, &ff_rx);

            if !focused {
                input_state.clear();
            }

            while let Some(GilrsEvent { id, event, .. }) = gilrs.next_event() {
                match event {
                    EventType::Connected | EventType::Disconnected => {
                        tester::sync_gamepad_list_cache_emit(&app_handle, &gilrs);
                    }
                    _ if !focused => {}
                    evt => {
                        let player_id: usize = id.into();

                        match evt {
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
                                for nav in [
                                    SemanticAction::NavigateUp,
                                    SemanticAction::NavigateDown,
                                    SemanticAction::NavigateLeft,
                                    SemanticAction::NavigateRight,
                                ] {
                                    input_state.release(player_id, nav);
                                }

                                if let Some(action) = mapper::map_axis(axis, value) {
                                    if input_state.press(player_id, action) {
                                        emit_action(&app_handle, player_id, action);
                                    }
                                }
                            }
                            EventType::ButtonRepeated(_, _)
                            | EventType::ButtonChanged(_, _, _)
                            | EventType::Dropped
                            | EventType::Connected
                            | EventType::Disconnected => {}
                        }
                    }
                }
            }

            if focused {
                for (player_id, action) in input_state.get_repeats() {
                    emit_action(&app_handle, player_id, action);
                }
            }

            gilrs.inc();
            tester::refresh_gamepad_cache(&gilrs);
            tester::emit_gamepad_state_if_due(
                &app_handle,
                &gilrs,
                focused,
                &mut last_telemetry_emit,
            );

            thread::sleep(Duration::from_millis(10));
        }
    });
}

fn emit_action(app: &AppHandle, player: usize, action: SemanticAction) {
    let payload = ControllerEvent { action, player };
    let _ = app.emit("controller_action", payload);
}
