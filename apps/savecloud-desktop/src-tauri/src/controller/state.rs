use super::actions::SemanticAction;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const REPEAT_DELAY: Duration = Duration::from_millis(400); // Tiempo antes de empezar a repetir
const REPEAT_RATE: Duration = Duration::from_millis(100); // Velocidad de repetición

pub struct InputState {
    active_actions: HashMap<(usize, SemanticAction), Instant>,
}

impl InputState {
    pub fn new() -> Self {
        Self {
            active_actions: HashMap::new(),
        }
    }

    pub fn press(&mut self, player: usize, action: SemanticAction) -> bool {
        // Retorna true si es la primera pulsación
        if !self.active_actions.contains_key(&(player, action)) {
            self.active_actions
                .insert((player, action), Instant::now() + REPEAT_DELAY);
            true
        } else {
            false
        }
    }

    pub fn release(&mut self, player: usize, action: SemanticAction) {
        self.active_actions.remove(&(player, action));
    }

    // Retorna las acciones que deben repetirse en este frame
    pub fn get_repeats(&mut self) -> Vec<(usize, SemanticAction)> {
        let now = Instant::now();
        let mut repeats = Vec::new();

        for (&(player, action), next_trigger) in self.active_actions.iter_mut() {
            // Solo repetimos acciones de navegación
            if is_navigation(action) && now >= *next_trigger {
                repeats.push((player, action));
                *next_trigger = now + REPEAT_RATE;
            }
        }
        repeats
    }
}

fn is_navigation(action: SemanticAction) -> bool {
    matches!(
        action,
        SemanticAction::NavigateUp
            | SemanticAction::NavigateDown
            | SemanticAction::NavigateLeft
            | SemanticAction::NavigateRight
    )
}
