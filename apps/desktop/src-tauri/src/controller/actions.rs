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
    /// Botón X (Xbox) / Cuadrado (PlayStation) / Y (Nintendo).
    ActionX,
    /// Botón Y (Xbox) / Triángulo (PlayStation) / X (Nintendo).
    ActionY,
    Menu,
    /// Start / Opciones (ventana Ajustes en Big Picture desde el cliente).
    Options,
    /// Perfil / cuenta (p. ej. View en Xbox, Share en PlayStation).
    Profile,
    PageLeft,
    PageRight,
}

#[derive(Debug, Clone, Serialize)]
pub struct ControllerEvent {
    pub action: SemanticAction,
    pub player: usize,
}
