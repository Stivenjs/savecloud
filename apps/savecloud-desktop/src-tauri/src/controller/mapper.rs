use super::actions::SemanticAction;
use gilrs::{Axis, Button};

const DEADZONE: f32 = 0.5;

pub fn map_button(button: Button) -> Option<SemanticAction> {
    match button {
        Button::South => Some(SemanticAction::Confirm), // A en Xbox, Cruz en PS
        Button::East => Some(SemanticAction::Back),     // B en Xbox, Círculo en PS
        Button::Start => Some(SemanticAction::Menu),
        Button::DPadUp => Some(SemanticAction::NavigateUp),
        Button::DPadDown => Some(SemanticAction::NavigateDown),
        Button::DPadLeft => Some(SemanticAction::NavigateLeft),
        Button::DPadRight => Some(SemanticAction::NavigateRight),
        _ => None,
    }
}

pub fn map_axis(axis: Axis, value: f32) -> Option<SemanticAction> {
    if value.abs() < DEADZONE {
        return None;
    }
    match (axis, value > 0.0) {
        (Axis::LeftStickY, true) => Some(SemanticAction::NavigateUp),
        (Axis::LeftStickY, false) => Some(SemanticAction::NavigateDown),
        (Axis::LeftStickX, true) => Some(SemanticAction::NavigateRight),
        (Axis::LeftStickX, false) => Some(SemanticAction::NavigateLeft),
        _ => None,
    }
}
