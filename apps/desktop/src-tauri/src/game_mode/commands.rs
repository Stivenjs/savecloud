//! Comandos Tauri públicos para el modo juego.

use tauri::{AppHandle, State};

use super::GameModeCtl;

#[tauri::command]
pub async fn game_mode_set_enabled(
    app: AppHandle,
    ctl: State<'_, GameModeCtl>,
    enabled: bool,
) -> Result<(), String> {
    let _guard = ctl.0.lock().await;
    super::apply::set_enabled(app, enabled).await
}

#[tauri::command]
pub async fn game_mode_refresh(app: AppHandle, ctl: State<'_, GameModeCtl>) -> Result<(), String> {
    let _guard = ctl.0.lock().await;
    super::apply::refresh_if_enabled(app).await
}
