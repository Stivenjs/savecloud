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
        let data_dir =
            dirs::data_dir().unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        let bin_dir = data_dir.join("SaveCloud").join("sunshine_bin");

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

        let mut command = Command::new(&bin_path);
        command
            .current_dir(self.bin_dir.join("Sunshine"))
            .arg("-0")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let child = command
            .spawn()
            .map_err(|e| format!("Fallo al ejecutar Sunshine: {}", e))?;

        *process_guard = Some(child);
        Ok(())
    }

    /// Inyecta un cliente de SaveCloud directamente en los dispositivos de confianza
    /// de Sunshine, saltándose por completo el protocolo de emparejamiento con PIN.
    pub fn inject_trusted_client(&self, client_cert: &str, unique_id: &str) -> Result<(), String> {
        let state_path = self
            .bin_dir
            .join("Sunshine")
            .join("config")
            .join("sunshine_state.json");

        let mut state: serde_json::Value = if state_path.exists() {
            let data = std::fs::read_to_string(&state_path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        let paired_clients = state.get_mut("paired_clients");
        let clients_array = if let Some(arr) = paired_clients.and_then(|v| v.as_array_mut()) {
            arr
        } else {
            state["paired_clients"] = serde_json::json!([]);
            state
                .get_mut("paired_clients")
                .unwrap()
                .as_array_mut()
                .unwrap()
        };

        if !clients_array.iter().any(|c| c["uniqueid"] == unique_id) {
            clients_array.push(serde_json::json!({
                "app_version": "SaveCloud 1.0",
                "client_cert": client_cert,
                "devices": "SaveCloud Client",
                "mac_address": "00:00:00:00:00:00",
                "salt": "SaveCloudZeroConfigSalt",
                "uniqueid": unique_id
            }));

            let new_json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
            std::fs::write(&state_path, new_json)
                .map_err(|e| format!("Fallo al guardar state: {}", e))?;
            log::info!("Cliente {} inyectado en sunshine_state.json", unique_id);
        }

        Ok(())
    }

    /// Provee un PIN a Sunshine vía stdin cuando el cliente solicita emparejamiento.
    pub async fn provide_pin(&self, pin: &str) -> Result<(), String> {
        use std::io::Write;

        let mut process_guard = self.process.lock().await;
        if let Some(child) = process_guard.as_mut() {
            if let Some(mut stdin) = child.stdin.take() {
                let pin_str = format!("{}\n", pin);
                if let Err(e) = stdin.write_all(pin_str.as_bytes()) {
                    return Err(format!("Fallo al escribir PIN en stdin: {}", e));
                }
                child.stdin = Some(stdin);
                return Ok(());
            }
        }
        Err("Sunshine no está corriendo o no tiene stdin disponible".into())
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
        let config_content = r#"
                # SaveCloud Dynamic Sunshine Config
                # Auto-generado - No modificar manualmente

                port = 47989
                fps = 60
            "#.to_string();

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
