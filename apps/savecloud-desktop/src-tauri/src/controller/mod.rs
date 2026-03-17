pub mod actions;
pub mod mapper;
pub mod state;

use actions::{ControllerEvent, SemanticAction};
use gilrs::{Event as GilrsEvent, EventType, Gilrs};
use state::InputState;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

pub fn start_gamepad_loop(app_handle: AppHandle) {
    thread::spawn(move || {
        let mut gilrs = Gilrs::new().unwrap();
        let mut input_state = InputState::new();

        loop {
            while let Some(GilrsEvent { id, event, .. }) = gilrs.next_event() {
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
                    _ => {}
                }
            }

            for (player_id, action) in input_state.get_repeats() {
                emit_action(&app_handle, player_id, action);
            }

            thread::sleep(Duration::from_millis(10));
        }
    });
}

fn emit_action(app: &AppHandle, player: usize, action: SemanticAction) {
    let payload = ControllerEvent { action, player };
    let _ = app.emit("controller_action", payload);
}
