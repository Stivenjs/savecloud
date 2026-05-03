//! Comandos Tauri para el panel «Probar mando» en Ajustes.

use super::tester::{self, GamepadSummary};
use crate::controller::driver_installer;

#[tauri::command]
pub fn list_connected_gamepads() -> Vec<GamepadSummary> {
    tester::list_cached_gamepads()
}

#[tauri::command]
pub fn gamepad_tester_session_start() {
    tester::gamepad_tester_session_start()
}

#[tauri::command]
pub fn gamepad_tester_session_stop() {
    tester::gamepad_tester_session_stop()
}

#[tauri::command]
pub fn gamepad_tester_trigger_rumble(gamepad_index: usize) -> Result<(), String> {
    tester::enqueue_test_rumble(gamepad_index)
}

#[tauri::command]
pub async fn gamepad_install_windows_runtime() -> Result<(), String> {
    driver_installer::install_windows_gamepad_runtime().await
}
