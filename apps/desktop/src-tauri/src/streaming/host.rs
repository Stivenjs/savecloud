//! # Orquestación del Servidor Sunshine (Host de Streaming)
//!
//! Este módulo implementa [`SunshineHost`], la estructura encargada de descargar la versión
//! portable de Sunshine, configurar las opciones de transmisión dinámica, gestionar el ciclo de vida
//! del proceso (iniciar/detener) e interceptar los eventos de logs en tiempo real.

use super::error::{StreamingError, StreamingResult};
use std::fmt::Debug;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

/// Versión oficial de Sunshine portable empaquetada y soportada.
const SUNSHINE_VERSION: &str = "v0.23.1";

/// Administrador del servidor local Sunshine para la transmisión de pantalla.
pub struct SunshineHost {
    app_handle: AppHandle,
    process: Arc<Mutex<Option<Child>>>,
    bin_dir: PathBuf,
}

impl Debug for SunshineHost {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SunshineHost")
            .field("bin_dir", &self.bin_dir)
            .finish_non_exhaustive()
    }
}

impl SunshineHost {
    /// Crea una nueva instancia de [`SunshineHost`].
    ///
    /// # Arguments
    /// * `app_handle` - Instancia de [`AppHandle`] para la emisión de eventos hacia el frontend.
    ///
    /// # Returns
    /// Retorna una nueva instancia estructurada de [`SunshineHost`].
    ///
    /// # Examples
    /// ```rust,ignore
    /// let host = SunshineHost::new(app_handle);
    /// ```
    #[must_use]
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

    /// Comprueba si el ejecutable de Sunshine portable está instalado en el equipo.
    ///
    /// # Returns
    /// Retorna `true` si el archivo ejecutable de Sunshine existe en la ruta de binarios.
    #[must_use]
    pub fn is_installed(&self) -> bool {
        #[cfg(target_os = "windows")]
        let bin_path = self.bin_dir.join("Sunshine").join("sunshine.exe");
        #[cfg(not(target_os = "windows"))]
        let bin_path = self.bin_dir.join("Sunshine").join("sunshine");

        bin_path.exists()
    }

    /// Descarga y extrae la versión portable de Sunshine de forma asíncrona y no bloqueante.
    ///
    /// # Errors
    /// Retorna [`StreamingError::Host`] si falla la descarga de GitHub Releases o la descompresión del ZIP.
    pub async fn download_and_extract(&self) -> StreamingResult<()> {
        if self.is_installed() {
            return Ok(());
        }

        #[cfg(not(target_os = "windows"))]
        {
            return Err(StreamingError::Host(
                "Descarga automática de Sunshine solo soportada en Windows por ahora".into(),
            ));
        }

        #[cfg(target_os = "windows")]
        {
            let zip_path = self.bin_dir.join("sunshine.zip");

            if !self.bin_dir.exists() {
                std::fs::create_dir_all(&self.bin_dir).map_err(|err| {
                    StreamingError::Host(format!("Fallo al crear directorio bin: {err}"))
                })?;
            }

            let url = format!(
                "https://github.com/LizardByte/Sunshine/releases/download/{SUNSHINE_VERSION}/sunshine-windows-portable.zip"
            );
            let response = reqwest::get(&url)
                .await
                .map_err(|err| StreamingError::Host(format!("Fallo al descargar Sunshine: {err}")))?;

            let bytes = response.bytes().await.map_err(|err| {
                StreamingError::Host(format!("Error leyendo bytes de la descarga: {err}"))
            })?;

            std::fs::write(&zip_path, &bytes)
                .map_err(|err| StreamingError::Host(format!("Fallo al guardar el archivo zip: {err}")))?;

            let bin_dir_clone = self.bin_dir.clone();
            let zip_path_clone = zip_path.clone();

            
            tokio::task::spawn_blocking(move || extract_zip_archive(&zip_path_clone, &bin_dir_clone))
                .await
                .map_err(|err| StreamingError::Host(format!("Error en tarea de extracción: {err}")))?
                ?;

            let _ = std::fs::remove_file(zip_path);

            Ok(())
        }
    }

    /// Inicia el proceso de Sunshine Host, genera la configuración dinámica y activa el monitoreo de logs.
    ///
    /// # Arguments
    /// * `session_state` - Referencia opcional al estado global de la sesión [`super::session::HostState`].
    ///
    /// # Errors
    /// Retorna [`StreamingError::Host`] o [`StreamingError::Config`] si falla la inicialización del ejecutable.
    pub async fn start(
        &self,
        session_state: Option<Arc<std::sync::Mutex<super::session::HostState>>>,
    ) -> StreamingResult<()> {
        let mut process_guard = self.process.lock().await;

        if let Some(mut child) = process_guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = Command::new("taskkill")
                .args(["/F", "/IM", "sunshine.exe"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
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
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        #[cfg(target_os = "windows")]
        {
            if is_current_process_elevated() {
                log::info!("[SunshineHost] Proceso elevado como Administrador. Sunshine capturará avisos UAC / Escritorio Seguro sin congelarse.");
            } else {
                log::info!("[SunshineHost] Proceso en modo estándar. Para capturar avisos UAC sin congelar video, ejecute SaveCloud como Administrador.");
            }
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            command.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = command
            .spawn()
            .map_err(|err| StreamingError::Host(format!("Fallo al ejecutar Sunshine: {err}")))?;

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let (Some(stdout), Some(stderr), Some(session_state)) = (stdout, stderr, session_state) {
            self.spawn_log_monitor(stdout, stderr, session_state);
        }

        *process_guard = Some(child);
        Ok(())
    }

    /// Lector de logs asíncrono en segundo plano.
    ///
    /// Intercepta las líneas producidas por el proceso Sunshine en stdout/stderr
    /// para actualizar el estado cuando se conectan o desconectan clientes.
    fn spawn_log_monitor(
        &self,
        stdout: std::process::ChildStdout,
        stderr: std::process::ChildStderr,
        session_state: Arc<std::sync::Mutex<super::session::HostState>>,
    ) {
        let app_handle = self.app_handle.clone();

        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};

            let session_stdout = session_state.clone();
            let app_stdout = app_handle.clone();

            let stdout_handle = std::thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    process_sunshine_log_line(&line, &session_stdout, &app_stdout);
                }
            });

            let stderr_handle = std::thread::spawn(move || {
                let reader = BufReader::new(stderr);
                for line in reader.lines().map_while(Result::ok) {
                    process_sunshine_log_line(&line, &session_state, &app_handle);
                }
            });

            let _ = stdout_handle.join();
            let _ = stderr_handle.join();
        });
    }

    /// Inyecta las credenciales de un cliente de confianza en `sunshine_state.json`.
    #[allow(dead_code)]
    pub fn inject_trusted_client(&self, client_cert: &str, unique_id: &str) -> StreamingResult<()> {
        let state_path = self
            .bin_dir
            .join("Sunshine")
            .join("config")
            .join("sunshine_state.json");

        if let Some(parent) = state_path.parent() {
            if !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|err| {
                    StreamingError::Config(format!("Fallo al crear directorio de configuración: {err}"))
                })?;
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
            .ok_or_else(|| StreamingError::Config("No se pudo acceder a root.devices".into()))?;

        if !devices
            .iter()
            .any(|d| d.get("uniqueid").and_then(|v| v.as_str()) == Some(unique_id))
        {
            devices.push(serde_json::json!({
                "uniqueid": unique_id,
                "certs": [client_cert]
            }));

            let new_json = serde_json::to_string_pretty(&state)
                .map_err(|err| StreamingError::Config(err.to_string()))?;
            std::fs::write(&state_path, new_json)
                .map_err(|err| StreamingError::Config(format!("Fallo al guardar state: {err}")))?;
            log::info!(
                "Cliente {unique_id} inyectado en sunshine_state.json (formato root.devices[].certs[])"
            );
        }

        Ok(())
    }

    /// Escribe el PIN en el `stdin` del proceso de Sunshine para completar el emparejamiento.
    ///
    /// # Arguments
    /// * `pin` - Código PIN de 4 dígitos proporcionado por el usuario o frontend.
    ///
    /// # Errors
    /// Retorna [`StreamingError::Host`] si Sunshine no está ejecutándose o si falla la escritura en stdin.
    pub async fn provide_pin(&self, pin: &str) -> StreamingResult<()> {
        use std::io::Write;

        let mut process_guard = self.process.lock().await;
        if let Some(child) = process_guard.as_mut() {
            if let Some(mut stdin) = child.stdin.take() {
                let pin_str = format!("{pin}\n");
                if let Err(err) = stdin.write_all(pin_str.as_bytes()) {
                    return Err(StreamingError::Host(format!(
                        "Fallo al escribir PIN en stdin: {err}"
                    )));
                }
                child.stdin = Some(stdin);
                return Ok(());
            }
        }
        Err(StreamingError::Host(
            "Sunshine no está corriendo o no tiene stdin disponible".into(),
        ))
    }

    /// Detiene el proceso de Sunshine Host y limpia la ejecución en segundo plano.
    pub async fn stop(&self) -> StreamingResult<()> {
        let mut process_guard = self.process.lock().await;

        let had_process = process_guard.is_some();
        if let Some(mut child) = process_guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        #[cfg(target_os = "windows")]
        if had_process {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "sunshine.exe"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }

        Ok(())
    }

    /// Genera la configuración `sunshine.conf` y `apps.json` para SaveCloud.
    fn generate_config(&self) -> StreamingResult<()> {
        let config_dir = self.bin_dir.join("Sunshine").join("config");
        if !config_dir.exists() {
            std::fs::create_dir_all(&config_dir)
                .map_err(|err| StreamingError::Config(format!("Fallo al crear directorio de configuración: {err}")))?;
        }

        let conf_path = config_dir.join("sunshine.conf");
        let apps_path = config_dir.join("apps.json");

        let sunshine_bin_dir = self.bin_dir.join("Sunshine");
        let audio_sink = crate::streaming::audio::detect_best_active_sink(&sunshine_bin_dir);

        let audio_sink_line = if let Some(sink) = audio_sink {
            format!("audio_sink = {sink}\nvirtual_sink = ")
        } else {
            "virtual_sink = ".to_string()
        };

        // Configuraciones base optimizadas para SaveCloud
        let config_content = format!(
            r#"
                # SaveCloud Dynamic Sunshine Config
                # Auto-generado - No modificar manualmente

                port = 47989
                fps = 60
                gamepad = disabled
                controller = disabled
                min_log_level = debug
                file_log_level = debug
                file_apps = apps.json
                file_state = sunshine_state.json
                {audio_sink_line}
            "#
        );

        std::fs::write(&conf_path, config_content).map_err(|err| {
            StreamingError::Config(format!("Fallo al escribir sunshine.conf: {err}"))
        })?;

        // Generar apps.json asegurando que Desktop use un comando persistente
        let apps_json = serde_json::json!({
            "env": {
                "PATH": "$(PATH)"
            },
            "apps": [
                {
                    "name": "Desktop",
                    "image-path": "desktop.png",
                    "detached": [
                        "cmd.exe /c echo SaveCloud Desktop Streaming"
                    ]
                },
                {
                    "name": "Steam Big Picture",
                    "image-path": "steam.png",
                    "detached": [
                        "steam://open/bigpicture"
                    ]
                }
            ]
        });

        let apps_content = serde_json::to_string_pretty(&apps_json)
            .map_err(|err| StreamingError::Config(err.to_string()))?;

        std::fs::write(&apps_path, apps_content)
            .map_err(|err| StreamingError::Config(format!("Fallo al escribir apps.json: {err}")))?;

        log::info!(
            "sunshine.conf y apps.json generados exitosamente en {:?}",
            config_dir
        );

        Ok(())
    }
}

/// Extrae el archivo comprimido ZIP de Sunshine portable.
fn extract_zip_archive(zip_path: &Path, bin_dir: &Path) -> StreamingResult<()> {
    let file = std::fs::File::open(zip_path)
        .map_err(|err| StreamingError::Host(format!("No se pudo abrir ZIP: {err}")))?;

    let mut archive = zip::ZipArchive::new(file)
        .map_err(|err| StreamingError::Host(format!("Formato ZIP inválido: {err}")))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|err| {
            StreamingError::Host(format!("Error leyendo entrada ZIP: {err}"))
        })?;
        let outpath = match entry.enclosed_name() {
            Some(path) => bin_dir.join(path),
            None => continue,
        };

        if entry.is_dir() {
            std::fs::create_dir_all(&outpath).ok();
        } else {
            if let Some(parent) = outpath.parent() {
                if !parent.exists() {
                    std::fs::create_dir_all(parent).ok();
                }
            }
            let mut outfile = std::fs::File::create(&outpath).map_err(|err| {
                StreamingError::Host(format!("Error creando archivo extraído: {err}"))
            })?;
            std::io::copy(&mut entry, &mut outfile).map_err(|err| {
                StreamingError::Host(format!("Error escribiendo archivo extraído: {err}"))
            })?;
        }
    }
    Ok(())
}

impl Drop for SunshineHost {
    fn drop(&mut self) {
        if let Ok(mut process) = self.process.try_lock() {
            if let Some(mut child) = process.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/IM", "sunshine.exe"])
                .creation_flags(CREATE_NO_WINDOW)
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = std::process::Command::new("pkill")
                .args(["-9", "sunshine"])
                .output();
        }
    }
}

/// Procesa las líneas de registro de Sunshine para actualizar el estado del Host en tiempo real sin polling.
fn process_sunshine_log_line(
    line: &str,
    session_state: &Arc<std::sync::Mutex<super::session::HostState>>,
    app_handle: &AppHandle,
) {
    use super::session::HostState;

    let lower = line.to_lowercase();

    let is_connected = lower.contains("client connected")
        || lower.contains("rtsp: connected")
        || lower.contains("rtsp/1.0 setup")
        || lower.contains("session started")
        || (lower.contains("rtsp") && lower.contains("setup"));

    let is_disconnected = lower.contains("client disconnected")
        || lower.contains("rtsp: disconnected")
        || lower.contains("rtsp/1.0 teardown")
        || lower.contains("session ended")
        || lower.contains("session stopped")
        || (lower.contains("rtsp") && lower.contains("teardown"));

    if is_connected || is_disconnected {
        if let Ok(mut session) = session_state.lock() {
            if let HostState::Hosting { ref mut clients, .. } = *session {
                let updated = if is_connected {
                    if clients.is_empty() {
                        clients.push("Cliente Conectado".to_string());
                        log::info!("[SunshineHost] Evento en tiempo real: Cliente conectado al stream");
                        true
                    } else {
                        false
                    }
                } else if !clients.is_empty() {
                    clients.clear();
                    log::info!("[SunshineHost] Evento en tiempo real: Cliente desconectado del stream");
                    true
                } else {
                    false
                };

                if updated {
                    let _ = app_handle.emit("streaming-state-changed", ());
                }
            }
        }
    }
}

/// Comprueba si el proceso actual posee privilegios elevados de Administrador en Windows.
#[cfg(target_os = "windows")]
fn is_current_process_elevated() -> bool {
    use std::mem::MaybeUninit;
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) != 0 {
            let mut elevation: MaybeUninit<TOKEN_ELEVATION> = MaybeUninit::uninit();
            let mut size = std::mem::size_of::<TOKEN_ELEVATION>() as u32;
            let res = GetTokenInformation(
                token,
                TokenElevation,
                elevation.as_mut_ptr() as *mut _,
                size,
                &mut size,
            );
            windows_sys::Win32::Foundation::CloseHandle(token);
            if res != 0 {
                let elev = elevation.assume_init();
                return elev.TokenIsElevated != 0;
            }
        }
    }
    false
}


