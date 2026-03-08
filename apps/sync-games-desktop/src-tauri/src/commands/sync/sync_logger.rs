//! Logger de diagnóstico para la sincronización (subida/descarga).
//!
//! Escribe en un archivo en el directorio de configuración para poder ver
//! qué está pasando cuando hay errores 500 u otros fallos. No sustituye
//! el manejo de errores; solo añade trazas para depuración.
//!
//! Archivo: `<config_dir>/sync-debug.log`

use chrono::Utc;
use std::sync::Mutex;

const LOG_FILE_NAME: &str = "sync-debug.log";
const MAX_BODY_PREVIEW: usize = 500;

fn log_path() -> Option<std::path::PathBuf> {
    crate::config::config_dir().map(|d| d.join(LOG_FILE_NAME))
}

static LOG_LOCK: Mutex<()> = Mutex::new(());

fn do_write_line(path: std::path::PathBuf, full: String) {
    let _guard = match LOG_LOCK.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = std::io::Write::write_all(&mut f, full.as_bytes());
    }
}

/// Escribe una línea en el log (timestamp + mensaje). En contexto async no bloquea el runtime.
fn write_line(line: &str) {
    let path = match log_path() {
        Some(p) => p,
        None => return,
    };
    let ts = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f UTC");
    let full = format!("[{}] {}\n", ts, line);
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        let _ = handle.spawn_blocking(move || do_write_line(path, full));
    } else {
        do_write_line(path, full);
    }
}

/// Ruta del archivo de log (para mostrarla en la UI o al usuario).
pub fn log_file_path() -> Option<String> {
    log_path().map(|p| p.to_string_lossy().into_owned())
}

/// Registra el inicio o un paso de una operación con contexto opcional.
pub fn log_operation(operation: &str, context: &str) {
    let line = format!("[OP] {} | {}", operation, context);
    write_line(&line);
}

/// Registra un error con operación y contexto.
pub fn log_error(operation: &str, context: &str, err: &str) {
    let escaped = err.replace('\n', " ").replace('\r', "");
    let line = format!("[ERROR] {} | {} | err: {}", operation, context, escaped);
    write_line(&line);
}

/// Registra una llamada API (método/endpoint, status, y un trozo del body para depurar 500).
pub fn log_api(operation: &str, endpoint: &str, status: u16, body_preview: &str) {
    let preview = body_preview
        .chars()
        .take(MAX_BODY_PREVIEW)
        .collect::<String>()
        .replace('\n', " ")
        .replace('\r', "");
    let line = format!(
        "[API] {} | {} | status: {} | body: {}",
        operation, endpoint, status, preview
    );
    write_line(&line);
}

/// Contexto típico para subida (game_id, filename, path).
pub fn upload_context(game_id: &str, filename: &str, absolute_path: &str) -> String {
    format!(
        "gameId={} filename={} path={}",
        game_id,
        filename,
        truncate_for_log(absolute_path, 200)
    )
}

fn truncate_for_log(s: &str, max: usize) -> String {
    let t: String = s.chars().take(max).collect();
    if s.len() > max {
        format!("{}...", t)
    } else {
        t
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_upload_context() {
        let c = upload_context("g1", "world/level.dat", "D:\\long\\path\\world");
        assert!(c.contains("gameId=g1"));
        assert!(c.contains("filename=world/level.dat"));
    }
}
