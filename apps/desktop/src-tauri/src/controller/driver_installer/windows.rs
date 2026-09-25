//! Implementación sólo compilada en `target_os = "windows"`.

use crate::network::DATA_CLIENT;
use crate::utils::launch_exe;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};

const DIRECTX_DETAILS_URL: &str = "https://www.microsoft.com/en-us/download/details.aspx?id=35";

pub async fn install_windows_gamepad_runtime() -> Result<(), String> {
    let download_url = resolve_dxwebsetup_url().await?;
    let installer_path = download_installer(&download_url).await?;
    let install_result = run_installer(&installer_path);
    let _ = std::fs::remove_file(&installer_path);
    install_result
}

async fn resolve_dxwebsetup_url() -> Result<String, String> {
    let html = DATA_CLIENT
        .get(DIRECTX_DETAILS_URL)
        .send()
        .await
        .map_err(|e| format!("No se pudo abrir la página oficial de DirectX: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Microsoft devolvió un error al solicitar DirectX: {e}"))?
        .text()
        .await
        .map_err(|e| format!("No se pudo leer la respuesta de Microsoft: {e}"))?;

    let rx = regex::Regex::new(r#"https://download\.microsoft\.com/[^\s"'<>]+dxwebsetup\.exe"#)
        .map_err(|e| format!("Error interno preparando la búsqueda de descarga: {e}"))?;

    let url = rx
        .find(&html)
        .map(|m| m.as_str().to_string())
        .ok_or_else(|| {
            "No encontramos un enlace oficial de dxwebsetup.exe en la página de Microsoft."
                .to_string()
        })?;

    Ok(url)
}

async fn download_installer(url: &str) -> Result<PathBuf, String> {
    let bytes = DATA_CLIENT
        .get(url)
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar dxwebsetup.exe: {e}"))?
        .error_for_status()
        .map_err(|e| format!("Microsoft devolvió un error al descargar dxwebsetup.exe: {e}"))?
        .bytes()
        .await
        .map_err(|e| format!("No se pudo leer la descarga de dxwebsetup.exe: {e}"))?;

    let mut target = std::env::temp_dir();
    target.push(format!("savecloud_dxwebsetup_{}.exe", uuid::Uuid::new_v4()));

    let mut f = File::create(&target)
        .map_err(|e| format!("No se pudo crear el archivo temporal del instalador: {e}"))?;
    f.write_all(&bytes)
        .map_err(|e| format!("No se pudo guardar el instalador descargado: {e}"))?;

    Ok(target)
}

fn run_installer(installer_path: &Path) -> Result<(), String> {
    let path = installer_path.to_string_lossy().to_string();
    launch_exe::launch_game_executable(&path).map_err(|e| {
        format!(
            "No se pudo iniciar el instalador de DirectX/XInput. Si ves UAC, acepta la elevación. Detalle: {e}"
        )
    })
}
