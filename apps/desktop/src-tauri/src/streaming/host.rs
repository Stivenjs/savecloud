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
    _app_handle: AppHandle,
    process: Arc<Mutex<Option<Child>>>,
    bin_dir: PathBuf,
}

impl SunshineHost {
    pub fn new(app_handle: AppHandle) -> Self {
        let data_dir =
            dirs::data_dir().unwrap_or_else(|| std::env::current_dir().unwrap_or_default());
        let bin_dir = data_dir.join("SaveCloud").join("sunshine_bin");

        Self {
            _app_handle: app_handle,
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

        let mut creds_cmd = Command::new(&bin_path);
        creds_cmd
            .current_dir(self.bin_dir.join("Sunshine"))
            .arg("--creds")
            .arg("savecloud")
            .arg("savecloud");

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            creds_cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let _ = creds_cmd.output();

        let mut command = Command::new(&bin_path);
        command
            .current_dir(self.bin_dir.join("Sunshine"))
            .arg("-0")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());

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

    #[allow(dead_code)]
    pub fn inject_trusted_client(&self, client_cert: &str, unique_id: &str) -> Result<(), String> {
        let state_path = self
            .bin_dir
            .join("Sunshine")
            .join("config")
            .join("sunshine_state.json");

        if let Some(parent) = state_path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("Fallo al crear config dir: {}", e))?;
            }
        }

        let mut state: serde_json::Value = if state_path.exists() {
            let data = std::fs::read_to_string(&state_path).unwrap_or_default();
            serde_json::from_str(&data).unwrap_or_else(|_| serde_json::json!({}))
        } else {
            serde_json::json!({})
        };

        if state.pointer("/root/uniqueid").is_none() {
            let server_id = uuid::Uuid::new_v4().to_string();
            if state.get("root").is_none() {
                state["root"] = serde_json::json!({});
            }
            state["root"]["uniqueid"] = serde_json::json!(server_id);
        }

        if state.pointer("/root/devices").is_none() {
            state["root"]["devices"] = serde_json::json!([]);
        }

        let devices = state
            .pointer_mut("/root/devices")
            .and_then(|v| v.as_array_mut())
            .ok_or("No se pudo acceder a root.devices")?;

        if !devices
            .iter()
            .any(|d| d.get("uniqueid").and_then(|v| v.as_str()) == Some(unique_id))
        {
            devices.push(serde_json::json!({
                "uniqueid": unique_id,
                "certs": [client_cert]
            }));

            let new_json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
            std::fs::write(&state_path, new_json)
                .map_err(|e| format!("Fallo al guardar state: {}", e))?;
            log::info!(
                "Cliente {} inyectado en sunshine_state.json (formato root.devices[].certs[])",
                unique_id
            );
        }

        Ok(())
    }

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

    pub async fn stop(&self) -> Result<(), String> {
        let mut process_guard = self.process.lock().await;

        if let Some(mut child) = process_guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        Ok(())
    }

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
                gamepad = disabled
                controller = disabled
                min_log_level = debug
                file_log_level = debug
                file_state = sunshine_state.json
            "#
        .to_string();

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
