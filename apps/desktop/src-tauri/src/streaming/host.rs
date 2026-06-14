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
#[cfg(target_os = "windows")]
const SUNSHINE_URL: &str = "https://github.com/LizardByte/Sunshine/releases/download/v0.23.1/sunshine-windows-portable.zip";

pub struct SunshineHost {
    app_handle: AppHandle,
    process: Arc<Mutex<Option<Child>>>,
    bin_dir: PathBuf,
}

impl SunshineHost {
    pub fn new(app_handle: AppHandle) -> Self {
        // En un entorno real, usaríamos app_handle.path().app_data_dir()
        // Para desarrollo usaremos una ruta relativa
        let bin_dir = std::env::current_dir()
            .unwrap_or_default()
            .join(".sunshine_bin");

        Self {
            app_handle,
            process: Arc::new(Mutex::new(None)),
            bin_dir,
        }
    }

    /// Comprueba si Sunshine ya está descargado y extraído.
    pub fn is_installed(&self) -> bool {
        #[cfg(target_os = "windows")]
        let bin_path = self.bin_dir.join("sunshine.exe");
        #[cfg(not(target_os = "windows"))]
        let bin_path = self.bin_dir.join("sunshine");

        bin_path.exists()
    }

    /// Descarga y extrae Sunshine de forma asíncrona.
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

            // Crear directorio si no existe
            if !self.bin_dir.exists() {
                std::fs::create_dir_all(&self.bin_dir)
                    .map_err(|e| format!("Fallo al crear directorio bin: {}", e))?;
            }

            // Descargar el zip
            let response = reqwest::get(SUNSHINE_URL)
                .await
                .map_err(|e| format!("Fallo al descargar Sunshine: {}", e))?;

            let bytes = response
                .bytes()
                .await
                .map_err(|e| format!("Error leyendo bytes de la descarga: {}", e))?;

            std::fs::write(&zip_path, bytes)
                .map_err(|e| format!("Fallo al guardar el zip: {}", e))?;

            // Extraer usando la librería zip ya integrada en el proyecto
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

            // Limpiar zip
            let _ = std::fs::remove_file(zip_path);

            Ok(())
        }
    }

    /// Inicia el servidor Sunshine en segundo plano.
    pub async fn start(&self) -> Result<(), String> {
        let mut process_guard = self.process.lock().await;

        if process_guard.is_some() {
            return Ok(()); // Ya está corriendo
        }

        if !self.is_installed() {
            self.download_and_extract().await?;
        }

        self.generate_config()?;

        #[cfg(target_os = "windows")]
        let bin_path = self.bin_dir.join("sunshine.exe");
        #[cfg(not(target_os = "windows"))]
        let bin_path = self.bin_dir.join("sunshine");

        let child = Command::new(&bin_path)
            .current_dir(&self.bin_dir)
            // .arg("--creds") // Sunshine portable no requiere servicio de admin
            // En un entorno de producción, suprimiríamos la consola en Windows
            // con std::os::windows::process::CommandExt CREATE_NO_WINDOW
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
        let config_dir = self.bin_dir.join("config");
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

                # Deshabilitar UI web por seguridad en LAN
                web_ui = disable
                port = 47989

                # Forzar resolución del host a coincidir con el cliente
                resolution = host
                fps = 60    

                # Configurar logs
                file_magic = disable
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
