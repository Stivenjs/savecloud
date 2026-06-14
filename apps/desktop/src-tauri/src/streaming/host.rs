#![allow(dead_code)]
//! Orquestación del servidor Sunshine.
//!
//! Se encarga de descargar Sunshine (versión portable), configurar el entorno,
//! gestionar su ciclo de vida (iniciar/detener) y proveer la información necesaria
//! (como el PIN) para el emparejamiento.

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Arc;
use tauri::AppHandle;
use tokio::sync::Mutex;

const SUNSHINE_VERSION: &str = "v0.23.1";

pub struct SunshineHost {
    app_handle: AppHandle,
    process: Arc<Mutex<Option<Child>>>,
    bin_dir: PathBuf,
}

impl SunshineHost {
    pub fn new(app_handle: AppHandle) -> Self {
        let bin_dir = std::env::current_dir()
            .unwrap_or_default()
            .join(".sunshine_bin");

        Self {
            app_handle,
            process: Arc::new(Mutex::new(None)),
            bin_dir,
        }
    }

    pub fn is_installed(&self) -> bool {
        #[cfg(target_os = "windows")]
        let bin_path = self.bin_dir.join("Sunshine").join("sunshine.exe");
        #[cfg(not(target_os = "windows"))]
        let bin_path = self.bin_dir.join("Sunshine").join("sunshine");

        bin_path.exists()
    }

    pub async fn download_and_extract(&self) -> Result<(), String> {
        if self.is_installed() {
            return Ok(());
        }

        #[cfg(not(target_os = "windows"))]
        {
            return Err(
                "Descarga automática de Sunshine solo soportada en Windows por ahora".into(),
            );
        }

        #[cfg(target_os = "windows")]
        {
            let zip_path = self.bin_dir.join("sunshine.zip");

            if !self.bin_dir.exists() {
                std::fs::create_dir_all(&self.bin_dir)
                    .map_err(|e| format!("Fallo al crear directorio bin: {}", e))?;
            }

            let url = format!("https://github.com/LizardByte/Sunshine/releases/download/{}/sunshine-windows-portable.zip", SUNSHINE_VERSION);
            let response = reqwest::get(&url)
                .await
                .map_err(|e| format!("Fallo al descargar Sunshine: {}", e))?;

            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("Error leyendo bytes de la descarga: {}", e))?;

            std::fs::write(&zip_path, bytes)
                .map_err(|e| format!("Fallo al guardar el zip: {}", e))?;

            let file = std::fs::File::open(&zip_path)
                .map_err(|e| format!("No se pudo abrir ZIP: {}", e))?;

            let mut archive =
                zip::ZipArchive::new(file).map_err(|e| format!("Formato ZIP inválido: {}", e))?;

            for i in 0..archive.len() {
                let mut entry = archive
                    .by_index(i)
                    .map_err(|e| format!("Error leyendo entrada ZIP: {}", e))?;
                let outpath = match entry.enclosed_name() {
                    Some(path) => self.bin_dir.join(path),
                    None => continue,
                };

                if entry.is_dir() {
                    std::fs::create_dir_all(&outpath).ok();
                } else {
                    if let Some(p) = outpath.parent() {
                        if !p.exists() {
                            std::fs::create_dir_all(p).ok();
                        }
                    }
                    let mut outfile = std::fs::File::create(&outpath)
                        .map_err(|e| format!("Error creando archivo extraído: {}", e))?;
                    std::io::copy(&mut entry, &mut outfile)
                        .map_err(|e| format!("Error escribiendo archivo extraído: {}", e))?;
                }
            }

            let _ = std::fs::remove_file(zip_path);

            Ok(())
        }
    }

    /// Inicia el servidor Sunshine en segundo plano.
    pub async fn start(&self) -> Result<(), String> {
        let mut process_guard = self.process.lock().await;

        if process_guard.is_some() {
            return Ok(());
        }

        if !self.is_installed() {
            self.download_and_extract().await?;
        }

        self.generate_config()?;

        #[cfg(target_os = "windows")]
        let bin_path = self.bin_dir.join("Sunshine").join("sunshine.exe");
        #[cfg(not(target_os = "windows"))]
        let bin_path = self.bin_dir.join("Sunshine").join("sunshine");

        let child = Command::new(&bin_path)
            .current_dir(self.bin_dir.join("Sunshine"))
            .spawn()
            .map_err(|e| format!("Fallo al ejecutar Sunshine: {}", e))?;

        *process_guard = Some(child);
        Ok(())
    }

    /// Detiene el servidor Sunshine de forma segura.
    pub async fn stop(&self) -> Result<(), String> {
        let mut process_guard = self.process.lock().await;

        if let Some(mut child) = process_guard.take() {
            // Intentar matar el proceso
            let _ = child.kill();
            let _ = child.wait();
        }

        Ok(())
    }

    /// Genera el archivo de configuración base de Sunshine
    fn generate_config(&self) -> Result<(), String> {
        let config_dir = self.bin_dir.join("Sunshine").join("config");
        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir)
                .map_err(|e| format!("Fallo al crear config dir: {}", e))?;
        }

        let conf_path = config_dir.join("sunshine.conf");

        // Configuraciones base optimizadas para SaveCloud
        let config_content = format!(
            r#"
                # SaveCloud Dynamic Sunshine Config
                # Auto-generado - No modificar manualmente

                port = 47989
                fps = 60
            "#
        );

        std::fs::write(&conf_path, config_content)
            .map_err(|e| format!("Fallo al escribir sunshine.conf: {}", e))?;

        Ok(())
    }
}

impl Drop for SunshineHost {
    fn drop(&mut self) {
        if let Ok(mut process) = self.process.try_lock() {
            if let Some(mut child) = process.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}
