//! Descarga de catálogos remotos (HTTP directo y fallback Scrapling).

use std::path::PathBuf;

use reqwest::header::{
    HeaderMap, HeaderName, CONTENT_TYPE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED,
};
use reqwest::StatusCode;
use sha2::{Digest, Sha256};
use tauri::{path::BaseDirectory, AppHandle, Manager};

use crate::network::API_CLIENT;

use super::super::domain::SourceSyncMetadata;

/// Cuerpo descargado junto con cabeceras HTTP relevantes.
pub(crate) struct FetchedCatalogBody {
    pub raw: String,
    pub headers: HeaderMap,
}

pub fn extract_header_value(headers: &HeaderMap, key: HeaderName) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.to_string())
}

pub fn content_hash(raw: &str) -> String {
    hex::encode(Sha256::digest(raw.as_bytes()))
}

pub fn looks_like_cloudflare_block(content_type: &str, raw: &str) -> bool {
    let lower = raw.to_ascii_lowercase();
    content_type.contains("text/html")
        || lower.contains("cloudflare")
        || lower.contains("cf-chl")
        || lower.contains("captcha")
        || lower.contains("attention required")
}

fn resolve_scrapling_script(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resolve("resources/scrapling_fetch.py", BaseDirectory::Resource)
        .map_err(|e| format!("No se pudo resolver el script de Scrapling: {e}"))
}

fn resolve_scrapling_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let bin_name = if cfg!(target_os = "windows") {
        "resources/scrapling_fetch.exe"
    } else {
        "resources/scrapling_fetch"
    };
    app.path()
        .resolve(bin_name, BaseDirectory::Resource)
        .map_err(|e| format!("No se pudo resolver el binario de Scrapling: {e}"))
}

fn find_python_executable() -> Result<(String, Vec<String>), String> {
    let candidates = [
        (std::env::var("PYTHON").ok(), Vec::<String>::new()),
        (Some("python".to_string()), Vec::<String>::new()),
        (Some("python3".to_string()), Vec::<String>::new()),
        (Some("py".to_string()), vec!["-3".to_string()]),
    ];

    for (candidate, args) in candidates {
        if let Some(executable) = candidate {
            if which::which(&executable).is_ok() {
                return Ok((executable, args));
            }
        }
    }

    Err("No se encontró Python en PATH. Instala Python 3.10+ para usar Scrapling.".to_string())
}

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

pub fn run_scrapling_fetch(app: &AppHandle, url: &str) -> Result<String, String> {
    /// Maximum time (seconds) to wait for the scrapling subprocess before killing it.
    const SCRAPLING_TIMEOUT_SECS: u64 = 90;

    let binary_path = resolve_scrapling_binary(app);
    let mut command = if let Some(bin_path) = binary_path.as_ref().ok().filter(|p| p.is_file()) {
        let mut cmd = std::process::Command::new(bin_path);
        cmd.arg(url);
        cmd
    } else {
        let script_path = resolve_scrapling_script(app)?;
        let (python_bin, prefix_args) = find_python_executable()?;
        let script_dir = script_path.parent().ok_or_else(|| {
            "No se pudo resolver el directorio del script de Scrapling".to_string()
        })?;

        let mut cmd = std::process::Command::new(python_bin);
        cmd.current_dir(script_dir)
            .args(prefix_args)
            .arg(script_path)
            .arg(url);
        cmd
    };

    command
        .env("PYTHONUNBUFFERED", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let child = command
        .spawn()
        .map_err(|e| format!("No se pudo ejecutar Scrapling: {e}"))?;

    let child_pid = child.id();

    let (tx, rx) = std::sync::mpsc::channel::<()>();
    let watchdog = std::thread::spawn(move || {
        match rx.recv_timeout(std::time::Duration::from_secs(SCRAPLING_TIMEOUT_SECS)) {
            Ok(()) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                log::warn!(
                    "Scrapling subprocess {} timed out after {}s — killing process tree",
                    child_pid,
                    SCRAPLING_TIMEOUT_SECS
                );
                kill_process_tree(child_pid);
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {}
        }
    });

    let output = child.wait_with_output().map_err(|e| {
        let _ = tx.send(());
        format!("Error al esperar resultado de Scrapling: {e}")
    })?;

    let _ = tx.send(());
    let _ = watchdog.join();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if let Some(code) = output.status.code() {
            if code == 3 {
                return Err(
                    "Scrapling: timeout — el proceso fue terminado después de 90 segundos"
                        .to_string(),
                );
            }
        }

        let details = if stderr.is_empty() { stdout } else { stderr };
        return Err(if details.is_empty() {
            "Scrapling falló sin mensaje de error".to_string()
        } else {
            format!("Scrapling falló: {details}")
        });
    }

    String::from_utf8(output.stdout).map_err(|e| format!("Scrapling devolvió texto no UTF-8: {e}"))
}

fn kill_process_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(0x08000000)
            .output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .args(["-9", &format!("-{pid}")])
            .output();
    }
}

pub(crate) fn should_attempt_scrapling(status: StatusCode) -> bool {
    !status.is_success()
        && matches!(
            status,
            StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS | StatusCode::SERVICE_UNAVAILABLE
        )
}

pub(crate) fn needs_scrapling(status: StatusCode, content_type: &str, raw: &str) -> bool {
    should_attempt_scrapling(status) || looks_like_cloudflare_block(content_type, raw)
}

/// Resultado de una descarga HTTP sin ejecutar Scrapling (para paralelizar la sync).
pub(crate) enum HttpFetchOutcome {
    NotModified,
    Body(FetchedCatalogBody),
    NeedsScrapling { headers: HeaderMap },
    Failed(String),
}

/// Descarga por HTTP; si hace falta Scrapling, devuelve `NeedsScrapling` sin bloquear.
pub(crate) async fn fetch_catalog_via_http(
    url: &str,
    sync: &SourceSyncMetadata,
    repair_missing_catalog: bool,
) -> HttpFetchOutcome {
    let response = match fetch_with_validators(url, sync).await {
        Ok(response) => response,
        Err(message) => return HttpFetchOutcome::Failed(message),
    };

    if response.status() == StatusCode::NOT_MODIFIED {
        if !repair_missing_catalog {
            return HttpFetchOutcome::NotModified;
        }

        let response = match fetch_fresh(url).await {
            Ok(response) => response,
            Err(message) => return HttpFetchOutcome::Failed(message),
        };

        if response.status() == StatusCode::NOT_MODIFIED {
            return HttpFetchOutcome::Failed(format!(
                "El servidor devolvió 304 para {url} pero el catálogo local no existe"
            ));
        }

        return read_http_response(url, response).await;
    }

    read_http_response(url, response).await
}

async fn read_http_response(_url: &str, response: reqwest::Response) -> HttpFetchOutcome {
    let status = response.status();
    let headers = response.headers().clone();
    let content_type = extract_header_value(&headers, CONTENT_TYPE)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let raw = match response.text().await {
        Ok(raw) => raw,
        Err(error) => {
            return HttpFetchOutcome::Failed(format!("No se pudo leer la respuesta: {error}"))
        }
    };

    if needs_scrapling(status, &content_type, &raw) {
        return HttpFetchOutcome::NeedsScrapling { headers };
    }

    if !status.is_success() {
        return HttpFetchOutcome::Failed(format!("La URL devolvió estado HTTP {status}"));
    }

    HttpFetchOutcome::Body(FetchedCatalogBody { raw, headers })
}

/// Aplica Scrapling cuando la respuesta HTTP indica bloqueo o error recuperable.
pub fn resolve_body_with_scrapling(
    app: &AppHandle,
    url: &str,
    status: StatusCode,
    content_type: &str,
    raw: String,
) -> Result<String, String> {
    if should_attempt_scrapling(status) || looks_like_cloudflare_block(content_type, raw.as_str()) {
        return run_scrapling_fetch(app, url);
    }
    if !status.is_success() {
        return Err(format!("La URL devolvió estado HTTP {status}"));
    }
    Ok(raw)
}

/// GET con validadores de caché (`ETag` / `If-Modified-Since`).
pub async fn fetch_with_validators(
    url: &str,
    sync: &SourceSyncMetadata,
) -> Result<reqwest::Response, String> {
    let mut request = API_CLIENT.get(url);
    if let Some(etag) = &sync.etag {
        request = request.header(IF_NONE_MATCH, etag);
    }
    if let Some(last_modified) = &sync.last_modified {
        request = request.header(IF_MODIFIED_SINCE, last_modified);
    }
    request
        .send()
        .await
        .map_err(|e| format!("No se pudo descargar la fuente: {e}"))
}

/// GET sin validadores (re-descarga forzada).
pub async fn fetch_fresh(url: &str) -> Result<reqwest::Response, String> {
    API_CLIENT
        .get(url)
        .send()
        .await
        .map_err(|e| format!("No se pudo re-descargar la fuente: {e}"))
}

/// Lee el cuerpo de una respuesta HTTP y aplica Scrapling si hace falta.
pub async fn read_catalog_body(
    app: &AppHandle,
    url: &str,
    response: reqwest::Response,
) -> Result<FetchedCatalogBody, String> {
    let status = response.status();
    let headers = response.headers().clone();
    let content_type = extract_header_value(&headers, CONTENT_TYPE)
        .unwrap_or_default()
        .to_ascii_lowercase();
    let raw = response
        .text()
        .await
        .map_err(|e| format!("No se pudo leer la respuesta: {e}"))?;
    let raw = resolve_body_with_scrapling(app, url, status, &content_type, raw)?;
    Ok(FetchedCatalogBody { raw, headers })
}

/// Descarga un catálogo por URL (importación directa desde ajustes).
pub async fn fetch_catalog_for_import(
    app: &AppHandle,
    url: &str,
) -> Result<FetchedCatalogBody, String> {
    let response = fetch_fresh(url).await?;
    read_catalog_body(app, url, response).await
}

/// Metadatos de sincronización derivados de una respuesta descargada.
pub fn sync_metadata_from_fetch(
    headers: &HeaderMap,
    raw: &str,
    checked_at: String,
) -> SourceSyncMetadata {
    SourceSyncMetadata {
        etag: extract_header_value(headers, ETAG),
        last_modified: extract_header_value(headers, LAST_MODIFIED),
        content_hash: Some(content_hash(raw)),
        last_checked_at: Some(checked_at.clone()),
        last_synced_at: Some(checked_at),
        sync_error: None,
    }
}
