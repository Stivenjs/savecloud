pub(crate) mod catalog;

use crate::config;
use crate::network;
use crate::network::stream_download::{stream_url_to_file, GlobalDownloadProgress};
use crate::sources::extractor::extract_archive;
use crate::utils::transfer_metrics::TransferSpeedTracker;
use serde::{Deserialize, Serialize};
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

pub(crate) fn find_named_file(directory: &Path, names: &[String]) -> Option<PathBuf> {
    let entries = std::fs::read_dir(directory).ok()?;
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Ok(entry_type) = entry.file_type() else {
            continue;
        };
        if entry_type.is_dir() {
            if let Some(found) = find_named_file(&path, names) {
                return Some(found);
            }
        } else if entry_type.is_file()
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| {
                    names
                        .iter()
                        .any(|candidate| candidate.eq_ignore_ascii_case(name))
                })
        {
            return Some(path);
        }
    }
    None
}

fn find_emulator_path(
    emulator: &catalog::EmulatorMetadata,
    settings: &config::AppSettings,
) -> Option<String> {
    let configured = settings.emulator_paths.get(&emulator.id);
    if let Some(path) = configured.filter(|path| Path::new(path).is_file()) {
        return Some(path.clone());
    }

    let platform = catalog::platform_key();
    let search_paths = emulator
        .executable_search_paths
        .get(platform)
        .into_iter()
        .flatten()
        .map(|path| PathBuf::from(catalog::expand_path(path)))
        .chain(
            config::paths::config_dir()
                .into_iter()
                .map(|directory| directory.join("emulators").join(&emulator.id)),
        );
    for path in search_paths {
        if path.is_file() {
            return Some(path.to_string_lossy().into_owned());
        }
        if path.is_dir() {
            if let Some(found) = find_named_file(&path, &emulator.executable_names) {
                return Some(found.to_string_lossy().into_owned());
            }
        }
    }

    let path_value = std::env::var_os("PATH").unwrap_or_default();
    let executable_paths = std::env::split_paths(&path_value);
    for directory in executable_paths {
        for name in &emulator.executable_names {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Some(candidate.to_string_lossy().into_owned());
            }
        }
    }

    configured.cloned()
}

#[tauri::command]
pub fn detect_emulators() -> Result<HashMap<String, EmulatorStatus>, String> {
    let settings = config::load_settings();
    Ok(catalog::all()?
        .iter()
        .map(|emulator| {
            let path = find_emulator_path(emulator, &settings);
            let installed = path.as_ref().is_some_and(|path| Path::new(path).exists())
                || config::paths::config_dir().is_some_and(|directory| {
                    directory
                        .join("emulators")
                        .join(&emulator.id)
                        .join(".savecloud-installed")
                        .is_file()
                });
            (
                emulator.id.clone(),
                EmulatorStatus {
                    name: emulator.name.clone(),
                    installed,
                    path,
                },
            )
        })
        .collect())
}

#[tauri::command]
pub fn set_emulator_path(emulator: String, path: String) -> Result<(), String> {
    let emulator_metadata =
        catalog::find(&emulator)?.ok_or_else(|| format!("Emulador desconocido: {emulator}"))?;
    if !emulator_metadata.save_sync_supported {
        return Err(format!(
            "{} no tiene soporte de rutas de ejecutable en SaveCloud",
            emulator_metadata.name
        ));
    }
    let mut settings = config::load_settings();
    let normalized_path = path.trim();
    if !Path::new(normalized_path).is_file() {
        return Err("La ruta seleccionada no apunta a un ejecutable existente".to_string());
    }
    settings
        .emulator_paths
        .insert(emulator_metadata.id.clone(), normalized_path.to_string());
    config::save_settings(&settings)?;
    Ok(())
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EmulatorArtifactType {
    Archive,
    AppImage,
}

#[tauri::command(rename_all = "camelCase")]
pub fn download_emulator(
    app: AppHandle,
    emulator: String,
    download_url: String,
    file_name: String,
    artifact_type: EmulatorArtifactType,
) -> Result<(), String> {
    let emulator_key = emulator.to_lowercase();
    if emulator_key.is_empty()
        || !emulator_key.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("Identificador de emulador inválido".to_string());
    }
    let emulator_metadata = catalog::find(&emulator_key)?
        .ok_or_else(|| format!("Emulador desconocido: {emulator_key}"))?;
    if !emulator_metadata.managed_install {
        return Err(format!(
            "{} no permite instalación administrada",
            emulator_metadata.name
        ));
    }
    let emulator_key = emulator_metadata.id.clone();
    validate_download_request(&download_url, &file_name)?;

    tauri::async_runtime::spawn(async move {
        let res = download_emulator_async(
            &app,
            &emulator_key,
            &download_url,
            &file_name,
            artifact_type,
        )
        .await;
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

fn validate_download_request(download_url: &str, file_name: &str) -> Result<(), String> {
    let parsed_url = url::Url::parse(download_url)
        .map_err(|error| format!("URL de descarga inválida: {error}"))?;
    if parsed_url.scheme() != "https" || parsed_url.host_str().is_none() {
        return Err("La descarga debe usar una URL HTTPS".to_string());
    }
    if file_name.trim().is_empty()
        || Path::new(file_name)
            .file_name()
            .and_then(|name| name.to_str())
            != Some(file_name)
    {
        return Err("Nombre de archivo de descarga inválido".to_string());
    }
    Ok(())
}

async fn download_emulator_async(
    app: &AppHandle,
    emulator: &str,
    download_url: &str,
    file_name: &str,
    artifact_type: EmulatorArtifactType,
) -> Result<(), String> {
    let cache_dir = config::paths::cache_dir()
        .ok_or_else(|| "No se pudo obtener el directorio de caché".to_string())?;
    let temp_zip_path = cache_dir.join(file_name);

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
        download_url,
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

    if matches!(artifact_type, EmulatorArtifactType::AppImage) {
        let appimage_path = dest_dir.join(file_name);
        std::fs::rename(&temp_zip_path, &appimage_path)
            .map_err(|error| format!("No se pudo instalar el AppImage: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(&appimage_path)
                .map_err(|error| format!("No se pudieron leer los permisos del AppImage: {error}"))?
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(&appimage_path, permissions)
                .map_err(|error| format!("No se pudieron aplicar permisos al AppImage: {error}"))?;
        }
    } else {
        extract_archive(app, "dummy-emu-job", &temp_zip_path, &dest_dir)?;
        let _ = std::fs::remove_file(&temp_zip_path);
    }

    let emulator_metadata =
        catalog::find(emulator)?.ok_or_else(|| format!("Emulador desconocido: {emulator}"))?;
    let executable = find_named_file(&dest_dir, &emulator_metadata.executable_names);
    let install_path = executable
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| dest_dir.to_string_lossy().into_owned());

    #[cfg(unix)]
    if let Some(path) = executable.as_ref() {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(metadata) = std::fs::metadata(path) {
            let mut permissions = metadata.permissions();
            permissions.set_mode(0o755);
            let _ = std::fs::set_permissions(path, permissions);
        }
    }

    std::fs::write(dest_dir.join(".savecloud-installed"), b"installed")
        .map_err(|error| format!("No se pudo registrar la instalación: {error}"))?;
    let mut settings = config::load_settings();
    settings
        .emulator_paths
        .insert(emulator.to_string(), install_path);
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
