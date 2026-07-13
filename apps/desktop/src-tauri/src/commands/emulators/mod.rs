use crate::config;
use crate::network;
use crate::network::stream_download::{stream_url_to_file, GlobalDownloadProgress};
use crate::sources::extractor::extract_zip;
use crate::utils::transfer_metrics::TransferSpeedTracker;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorStatus {
    pub name: String,
    pub installed: bool,
    pub path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorProgressPayload {
    pub emulator: String,
    pub status: String, // "downloading" | "extracting" | "finished" | "failed"
    pub loaded: u64,
    pub total: u64,
    pub speed: Option<u64>,
    pub eta: Option<u64>,
    pub error: Option<String>,
}

fn is_valid_exe(path_str: &Option<String>) -> bool {
    if let Some(ref p) = path_str {
        if p.trim().is_empty() {
            return false;
        }
        let path = Path::new(p);
        path.exists() && path.is_file()
    } else {
        false
    }
}

fn find_in_standard_paths(exe_names: &[&str]) -> Option<String> {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let localappdata = std::env::var("LOCALAPPDATA").unwrap_or_default();

    let mut paths_to_check = vec![];

    if !appdata.is_empty() {
        paths_to_check.push(PathBuf::from(&appdata).join("Ryujinx/publish/Ryujinx.exe"));
        paths_to_check.push(PathBuf::from(&appdata).join("Ryujinx/Ryujinx.exe"));
        paths_to_check.push(PathBuf::from(&appdata).join("shadps4/shadps4.exe"));
    }
    if !localappdata.is_empty() {
        paths_to_check.push(PathBuf::from(&localappdata).join("Ryujinx/publish/Ryujinx.exe"));
        paths_to_check.push(PathBuf::from(&localappdata).join("Ryujinx/Ryujinx.exe"));
        paths_to_check.push(PathBuf::from(&localappdata).join("shadps4/shadps4.exe"));
    }

    if let Some(config_dir) = config::paths::config_dir() {
        paths_to_check.push(config_dir.join("emulators/ryujinx/publish/Ryujinx.exe"));
        paths_to_check.push(config_dir.join("emulators/ryujinx/Ryujinx.exe"));
        paths_to_check.push(config_dir.join("emulators/shadps4/shadps4.exe"));
    }

    for path in paths_to_check {
        if path.exists() && path.is_file() {
            if let Some(filename) = path.file_name().and_then(|f| f.to_str()) {
                if exe_names.contains(&filename.to_lowercase().as_str()) {
                    return Some(path.to_string_lossy().into_owned());
                }
            }
        }
    }
    None
}

#[tauri::command]
pub fn detect_emulators() -> Result<HashMap<String, EmulatorStatus>, String> {
    let settings = config::load_settings();
    let mut map = HashMap::new();

    // Ryujinx
    let ryujinx_installed = is_valid_exe(&settings.ryujinx_path);
    let ryujinx_path = if ryujinx_installed {
        settings.ryujinx_path.clone()
    } else {
        find_in_standard_paths(&["ryujinx.exe"])
    };

    map.insert(
        "ryujinx".to_string(),
        EmulatorStatus {
            name: "Ryujinx".to_string(),
            installed: ryujinx_path.is_some(),
            path: ryujinx_path,
        },
    );

    // ShadPS4
    let shadps4_installed = is_valid_exe(&settings.shadps4_path);
    let shadps4_path = if shadps4_installed {
        settings.shadps4_path.clone()
    } else {
        find_in_standard_paths(&["shadps4.exe"])
    };

    map.insert(
        "shadps4".to_string(),
        EmulatorStatus {
            name: "ShadPS4".to_string(),
            installed: shadps4_path.is_some(),
            path: shadps4_path,
        },
    );

    Ok(map)
}

#[tauri::command]
pub fn set_emulator_path(emulator: String, path: String) -> Result<(), String> {
    let mut settings = config::load_settings();
    let normalized_path = Some(path.trim().to_string()).filter(|s| !s.is_empty());

    if emulator.to_lowercase() == "ryujinx" {
        settings.ryujinx_path = normalized_path;
    } else if emulator.to_lowercase() == "shadps4" {
        settings.shadps4_path = normalized_path;
    } else {
        return Err(format!("Emulador desconocido: {}", emulator));
    }

    config::save_settings(&settings)?;
    Ok(())
}

#[tauri::command]
pub fn download_emulator(app: AppHandle, emulator: String) -> Result<(), String> {
    let emulator_key = emulator.to_lowercase();
    if emulator_key != "ryujinx" && emulator_key != "shadps4" {
        return Err(format!("Emulador no soportado para descarga: {}", emulator));
    }

    tauri::async_runtime::spawn(async move {
        let res = download_emulator_async(&app, &emulator_key).await;
        if let Err(e) = res {
            log::error!("Error al descargar emulador {}: {}", emulator_key, e);
            let _ = app.emit(
                "emulator-download-progress",
                EmulatorProgressPayload {
                    emulator: emulator_key.clone(),
                    status: "failed".to_string(),
                    loaded: 0,
                    total: 0,
                    speed: None,
                    eta: None,
                    error: Some(e),
                },
            );
        }
    });

    Ok(())
}

async fn download_emulator_async(app: &AppHandle, emulator: &str) -> Result<(), String> {
    let api_url = if emulator == "ryujinx" {
        "https://git.ryujinx.app/api/v1/repos/Ryubing/Ryujinx/releases/latest".to_string()
    } else {
        "https://api.github.com/repos/shadps4-emu/shadps4/releases/latest".to_string()
    };

    let response = network::API_CLIENT
        .get(&api_url)
        .header("User-Agent", "SaveCloud-desktop/1.0")
        .send()
        .await
        .map_err(|e| format!("Error conectando con la API del emulador: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "La API del emulador respondió con error: {}",
            response.status()
        ));
    }

    let release_json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Error decodificando respuesta de la API del emulador: {}", e))?;

    let assets = release_json["assets"]
        .as_array()
        .ok_or_else(|| "No se encontraron assets en la release de GitHub".to_string())?;

    let mut download_url = None;
    let mut file_name = None;

    for asset in assets {
        if let Some(name) = asset["name"].as_str() {
            let lower_name = name.to_lowercase();
            let is_match = if emulator == "ryujinx" {
                lower_name.contains("win")
                    && lower_name.contains("x64")
                    && lower_name.ends_with(".zip")
            } else {
                lower_name.contains("win") && lower_name.ends_with(".zip")
            };

            if is_match {
                download_url = asset["browser_download_url"]
                    .as_str()
                    .map(|s| s.to_string());
                file_name = Some(name.to_string());
                break;
            }
        }
    }

    let download_url = download_url.ok_or_else(|| {
        format!(
            "No se encontró un archivo .zip para Windows en los assets de {}",
            emulator
        )
    })?;
    let file_name = file_name.unwrap_or_else(|| format!("{}.zip", emulator));

    let cache_dir = config::paths::cache_dir()
        .ok_or_else(|| "No se pudo obtener el directorio de caché".to_string())?;
    let temp_zip_path = cache_dir.join(&file_name);

    let config_dir = config::paths::config_dir()
        .ok_or_else(|| "No se pudo obtener el directorio de configuración".to_string())?;
    let dest_dir = config_dir.join("emulators").join(emulator);

    if !dest_dir.exists() {
        std::fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("No se pudo crear el directorio de destino: {}", e))?;
    }

    let cancel_flag = Arc::new(AtomicBool::new(false));
    let mut speed_tracker = TransferSpeedTracker::default();

    let app_clone = app.clone();
    let emu_name = emulator.to_string();

    let on_progress = move |loaded, total, speed, eta| {
        let _ = app_clone.emit(
            "emulator-download-progress",
            EmulatorProgressPayload {
                emulator: emu_name.clone(),
                status: "downloading".to_string(),
                loaded,
                total,
                speed: Some(speed),
                eta,
                error: None,
            },
        );
        Ok(())
    };

    stream_url_to_file(
        &network::API_CLIENT,
        &download_url,
        &temp_zip_path,
        0,
        None,
        cancel_flag,
        None,
        &mut speed_tracker,
        GlobalDownloadProgress {
            loaded_offset: 0,
            total_bytes: 0,
        },
        on_progress,
    )
    .await?;

    let app_clone = app.clone();
    let emu_name = emulator.to_string();
    let _ = app_clone.emit(
        "emulator-download-progress",
        EmulatorProgressPayload {
            emulator: emu_name.clone(),
            status: "extracting".to_string(),
            loaded: 0,
            total: 0,
            speed: None,
            eta: None,
            error: None,
        },
    );

    extract_zip(app, "dummy-emu-job", &temp_zip_path, &dest_dir)?;

    let _ = std::fs::remove_file(&temp_zip_path);

    let mut exe_path = None;

    fn find_exe(dir: &Path, exe_name: &str) -> Option<PathBuf> {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.filter_map(Result::ok) {
                let path = entry.path();
                if path.is_dir() {
                    if let Some(p) = find_exe(&path, exe_name) {
                        return Some(p);
                    }
                } else if path.is_file() {
                    if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                        if name.to_lowercase() == exe_name.to_lowercase() {
                            return Some(path);
                        }
                    }
                }
            }
        }
        None
    }

    let exe_name = if emulator == "ryujinx" {
        "Ryujinx.exe"
    } else {
        "shadps4.exe"
    };
    if let Some(found_path) = find_exe(&dest_dir, exe_name) {
        exe_path = Some(found_path.to_string_lossy().into_owned());
    }

    let exe_path_str = exe_path.ok_or_else(|| {
        format!(
            "No se pudo encontrar el ejecutable {} en el archivo descomprimido",
            exe_name
        )
    })?;

    let mut settings = config::load_settings();
    if emulator == "ryujinx" {
        settings.ryujinx_path = Some(exe_path_str.clone());
    } else {
        settings.shadps4_path = Some(exe_path_str.clone());
    }
    config::save_settings(&settings)?;

    let _ = app.emit(
        "emulator-download-progress",
        EmulatorProgressPayload {
            emulator: emulator.to_string(),
            status: "finished".to_string(),
            loaded: 100,
            total: 100,
            speed: None,
            eta: None,
            error: None,
        },
    );

    let _ = app.emit("config-changed", ());

    Ok(())
}
