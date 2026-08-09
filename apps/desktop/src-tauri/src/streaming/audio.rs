//! Gestión y detección dinámica de dispositivos de audio en Windows para Sunshine.

use std::path::Path;
use std::process::Command;

#[derive(Debug)]
struct AudioDevice {
    name: String,
    is_active: bool,
}

/// Detecta el mejor dispositivo de audio activo en el sistema Windows.
/// Ejecuta la herramienta `audio-info.exe` provista por Sunshine y parsea su salida.
///
/// Retorna `None` si no se detecta ningún dispositivo activo o si ocurre un error.
pub fn detect_best_active_sink(sunshine_bin_dir: &Path) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        let audio_info_path = sunshine_bin_dir.join("tools").join("audio-info.exe");
        if !audio_info_path.exists() {
            log::warn!(
                "No se encontró la herramienta audio-info.exe en {:?}",
                audio_info_path
            );
            return None;
        }

        let mut cmd = Command::new(&audio_info_path);
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);

        let output = match cmd.output() {
            Ok(out) => out,
            Err(e) => {
                log::error!("Fallo al ejecutar audio-info.exe: {}", e);
                return None;
            }
        };

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut devices = Vec::new();
        let mut current_dev = AudioDevice {
            name: String::new(),
            is_active: false,
        };

        for line in stdout.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Device name") {
                if let Some(val) = trimmed.split(':').nth(1) {
                    current_dev.name = val.trim().to_string();
                }
            } else if trimmed.starts_with("Device state") {
                if trimmed.contains("Active") {
                    current_dev.is_active = true;
                }
            } else if (trimmed.starts_with("===== Device =====")
                || trimmed.starts_with("====== Found"))
                && !current_dev.name.is_empty()
            {
                devices.push(current_dev);
                current_dev = AudioDevice {
                    name: String::new(),
                    is_active: false,
                };
            }
        }
        if !current_dev.name.is_empty() {
            devices.push(current_dev);
        }

        // Buscar el mejor dispositivo activo prioritario (Speakers, Altavoces, Auriculares, Realtek, FxSound)
        let best = devices.iter().find(|d| {
            d.is_active
                && (d.name.contains("Speakers")
                    || d.name.contains("Altavoces")
                    || d.name.contains("Auriculares")
                    || d.name.contains("Realtek")
                    || d.name.contains("FxSound"))
        });

        if let Some(dev) = best {
            log::info!("Dispositivo de audio preferido detectado: {}", dev.name);
            Some(dev.name.clone())
        } else if let Some(dev) = devices.iter().find(|d| d.is_active) {
            log::info!(
                "Dispositivo de audio activo de respaldo detectado: {}",
                dev.name
            );
            Some(dev.name.clone())
        } else {
            log::warn!("No se detectó ningún dispositivo de audio activo");
            None
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = sunshine_bin_dir;
        None
    }
}
