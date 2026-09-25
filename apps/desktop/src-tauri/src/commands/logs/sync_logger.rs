//! Módulo de logging de diagnóstico para procesos de sincronización.
//!
//! Registra información detallada de operaciones de subida y descarga,
//! facilitando el análisis de fallos y comportamientos inesperados.
//!
//! Los logs se almacenan en el directorio de configuración de la aplicación.
//!
//! # Archivos de salida
//!
//! - `<config_dir>/savecloud-debug.log`
//!
//! # Rotación de logs
//!
//! Se implementa rotación automática de archivos:
//!
//! - `savecloud-debug.log`
//! - `savecloud-debug.1.log`
//! - `savecloud-debug.2.log`
use chrono::Utc;
use std::sync::Mutex;

const LOG_FILE_NAME: &str = "savecloud-debug.log";
const MAX_BODY_PREVIEW: usize = 500;

const MAX_LOG_SIZE: u64 = 5 * 1024 * 1024; // 5MB
const MAX_LOG_FILES: usize = 3;

fn log_path() -> Option<std::path::PathBuf> {
    crate::config::config_dir().map(|d| d.join("logs").join(LOG_FILE_NAME))
}

static LOG_LOCK: Mutex<()> = Mutex::new(());

fn do_write_line(path: std::path::PathBuf, full: String) {
    let _guard = match LOG_LOCK.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    rotate_log_if_needed(&path);

    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = std::io::Write::write_all(&mut f, full.as_bytes());
    }
}

/// Rotación automática del log cuando supera MAX_LOG_SIZE
fn rotate_log_if_needed(path: &std::path::Path) {
    let metadata = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(_) => return,
    };

    if metadata.len() < MAX_LOG_SIZE {
        return;
    }

    let parent = match path.parent() {
        Some(p) => p,
        None => return,
    };

    let stem = match path.file_stem().and_then(|s| s.to_str()) {
        Some(s) => s,
        None => return,
    };

    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

    // eliminar el más antiguo
    let oldest = parent.join(format!("{}.{}.{}", stem, MAX_LOG_FILES - 1, ext));
    let _ = std::fs::remove_file(oldest);

    // rotar archivos
    for i in (1..MAX_LOG_FILES).rev() {
        let src = parent.join(format!("{}.{}.{}", stem, i - 1, ext));
        let dst = parent.join(format!("{}.{}.{}", stem, i, ext));

        if src.exists() {
            let _ = std::fs::rename(src, dst);
        }
    }

    // mover el actual a .1
    let first = parent.join(format!("{}.1.{}", stem, ext));
    let _ = std::fs::rename(path, first);
}

/// Formatea bloques de log ordenados
fn format_block(level: &str, kind: &str, lines: Vec<(&str, String)>) -> String {
    let ts = Utc::now().format("%Y-%m-%d %H:%M:%S%.3f UTC");

    let mut out = format!("\n[{}] {:<5} {}\n", ts, level, kind);

    for (k, v) in lines {
        out.push_str(&format!("  {:<10}: {}\n", k, v));
    }

    out
}

/// Escribe una línea en el log sin bloquear el runtime async
fn write_line(line: String) {
    let path = match log_path() {
        Some(p) => p,
        None => return,
    };

    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        drop(handle.spawn_blocking(move || do_write_line(path, line)));
    } else {
        do_write_line(path, line);
    }
}

/// Ruta del archivo de log (para mostrar en UI)
pub fn log_file_path() -> Option<String> {
    log_path().map(|p| p.to_string_lossy().into_owned())
}

/// Registra inicio o paso de operación
pub fn log_operation(operation: &str, context: &str) {
    let block = format_block(
        "INFO",
        "OPERATION",
        vec![
            ("operation", operation.to_string()),
            ("context", context.to_string()),
        ],
    );

    write_line(block);
}

/// Registra error
pub fn log_error(operation: &str, context: &str, err: &str) {
    let escaped = err.replace('\n', " ").replace('\r', "");

    let block = format_block(
        "ERROR",
        "ERROR",
        vec![
            ("operation", operation.to_string()),
            ("context", context.to_string()),
            ("message", escaped),
        ],
    );

    write_line(block);
}

/// Registra llamada API
pub fn log_api(operation: &str, endpoint: &str, status: u16, body_preview: &str) {
    let preview = body_preview
        .chars()
        .take(MAX_BODY_PREVIEW)
        .collect::<String>()
        .replace('\n', " ")
        .replace('\r', "");

    let block = format_block(
        if status >= 400 { "ERROR" } else { "INFO" },
        "API",
        vec![
            ("operation", operation.to_string()),
            ("endpoint", endpoint.to_string()),
            ("status", status.to_string()),
            ("body", preview),
        ],
    );

    write_line(block);
}

/// Registra transición de estado de una operación de sync en formato estructurado.
pub fn log_transition(
    operation_id: &str,
    strategy: Option<&str>,
    prev_state: Option<&str>,
    next_state: &str,
    reason_code: Option<&str>,
) {
    let block = format_block(
        "INFO",
        "TRANSITION",
        vec![
            ("operationId", operation_id.to_string()),
            ("strategy", strategy.unwrap_or("unknown").to_string()),
            ("prevState", prev_state.unwrap_or("unknown").to_string()),
            ("nextState", next_state.to_string()),
            ("reasonCode", reason_code.unwrap_or("").to_string()),
        ],
    );
    write_line(block);
}

/// Contexto típico para subida
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
