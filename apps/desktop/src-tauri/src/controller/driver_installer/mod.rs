//! Instalación asistida del runtime de DirectX/XInput para mandos en Windows.

#[cfg(target_os = "windows")]
mod windows;

#[cfg(target_os = "windows")]
pub use windows::install_windows_gamepad_runtime;

#[cfg(not(target_os = "windows"))]
pub async fn install_windows_gamepad_runtime() -> Result<(), String> {
    Err(
        "La instalación automática del driver de mandos solo está disponible en Windows."
            .to_string(),
    )
}
