use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SemanticAction {
    NavigateUp,
    NavigateDown,
    NavigateLeft,
    NavigateRight,
    Confirm,
    Back,
    Menu,
}

#[derive(Debug, Clone, Serialize)]
pub struct ControllerEvent {
    pub action: SemanticAction,
    pub player: usize,
}
