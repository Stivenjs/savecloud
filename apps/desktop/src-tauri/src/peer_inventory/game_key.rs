//! Claves canónicas de juego para el índice de inventario.

use crate::config::ConfiguredGame;

/// `steam:{appId}` para catálogo / instalación Steam.
pub fn game_key_for_catalog_steam(steam_app_id: &str) -> Option<String> {
    let id = steam_app_id.trim();
    if id.is_empty() {
        return None;
    }
    Some(format!("steam:{id}"))
}

/// `steam:{appId}` o `savecloud:{configuredGameId}`.
pub fn game_key_for_configured_game(game: &ConfiguredGame) -> Option<String> {
    if let Some(ref steam) = game.steam_app_id {
        if let Some(key) = game_key_for_catalog_steam(steam) {
            return Some(key);
        }
    }
    let id = game.id.trim();
    if id.is_empty() {
        return None;
    }
    Some(format!("savecloud:{id}"))
}
