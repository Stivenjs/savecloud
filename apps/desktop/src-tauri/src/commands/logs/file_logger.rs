//! Módulo de inicialización de logs del sistema y salida dual (consola + archivo).
//!
//! Garantiza que todos los eventos emitidos mediante las macros estándar `log` (`info!`, `warn!`, `error!`)
//! se escriban simultáneamente en la salida estándar (`stdout`) y en un archivo de log persistente.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::Mutex;

/// Filtro por defecto para el sistema de logs.
const DEFAULT_LOG_FILTER: &str = "warn,librqbit=off,rqbit=off,savecloud_desktop_lib=info";

/// Nombre de la carpeta y archivo de log dentro del directorio de datos de usuario.
const APP_DIR_NAME: &str = "SaveCloud";
const LOGS_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "savecloud.log";
/// Tamaño máximo permitido para el archivo de log antes de rotar (5 MB).
const MAX_LOG_FILE_SIZE_BYTES: u64 = 5 * 1024 * 1024;

/// `DualWriter` implementa `std::io::Write` duplicando el flujo de bytes recibido
/// hacia `stdout` y hacia un archivo físico protegido por un `Mutex` para acceso multihilo seguro.
pub struct DualWriter {
    file: Option<Mutex<File>>,
}

impl DualWriter {
    /// Crea un nuevo `DualWriter` con el archivo opcional proporcionado.
    pub fn new(file: Option<File>) -> Self {
        Self {
            file: file.map(Mutex::new),
        }
    }
}

impl Write for DualWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let _ = io::stdout().write_all(buf);
        if let Some(ref file_mutex) = self.file {
            if let Ok(mut file) = file_mutex.lock() {
                let _ = file.write_all(buf);
            }
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let _ = io::stdout().flush();
        if let Some(ref file_mutex) = self.file {
            if let Ok(mut file) = file_mutex.lock() {
                let _ = file.flush();
            }
        }
        Ok(())
    }
}

/// Obtiene la ruta absoluta al archivo de logs del sistema (`%APPDATA%/SaveCloud/logs/savecloud.log`).
pub fn get_log_file_path() -> PathBuf {
    dirs::data_dir()
        .map(|d| d.join(APP_DIR_NAME).join(LOGS_DIR_NAME))
        .unwrap_or_else(|| PathBuf::from(LOGS_DIR_NAME))
        .join(LOG_FILE_NAME)
}

/// Rota el archivo de log si su tamaño supera el límite configurado (`MAX_LOG_FILE_SIZE_BYTES`).
/// El archivo antiguo se renombra a `savecloud.log.old`, conservando un único respaldo.
fn rotate_log_if_needed(log_file_path: &PathBuf) {
    if let Ok(metadata) = fs::metadata(log_file_path) {
        if metadata.len() >= MAX_LOG_FILE_SIZE_BYTES {
            let backup_path = log_file_path.with_extension("log.old");
            let _ = fs::rename(log_file_path, backup_path);
        }
    }
}

/// Inicializa el logger global de la aplicación (`env_logger`).
///
/// Debe invocarse una sola vez durante la secuencia de arranque en `lib.rs`.
pub fn init_logging() {
    let log_file_path = get_log_file_path();

    if let Some(parent) = log_file_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    rotate_log_if_needed(&log_file_path);

    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)
        .ok();

    let writer = DualWriter::new(file);

    let _ = env_logger::Builder::from_env(
        env_logger::Env::default().default_filter_or(DEFAULT_LOG_FILTER),
    )
    .format_timestamp_millis()
    .target(env_logger::Target::Pipe(Box::new(writer)))
    .try_init();

    log::info!(
        "Sistema de logging inicializado. Archivo de logs en: {}",
        log_file_path.display()
    );
}
