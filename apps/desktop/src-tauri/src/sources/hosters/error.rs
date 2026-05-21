//! Errores del subsistema de resolución de enlaces por hoster.

use crate::network::HttpStatusError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum HosterError {
    #[error("URL inválida: {0}")]
    InvalidUrl(String),

    #[error("No se pudo resolver el enlace: {0}")]
    ResolutionFailed(String),

    #[error("HTTP {0}")]
    Http(u16),

    #[error("Error de red: {0}")]
    Network(#[from] reqwest::Error),
}

impl From<HttpStatusError> for HosterError {
    fn from(e: HttpStatusError) -> Self {
        match e.status {
            401 | 403 | 404 | 429 => HosterError::ResolutionFailed(e.user_message()),
            _ if e.phase == crate::network::RequestPhase::Download => {
                HosterError::ResolutionFailed(e.user_message())
            }
            s => HosterError::Http(s),
        }
    }
}

pub fn ensure_resolve(response: reqwest::Response) -> Result<reqwest::Response, HosterError> {
    crate::network::ensure_resolve_success(response).map_err(HosterError::from)
}

/// Mensaje cuando la API de Gofile devuelve `status` distinto de `ok`.
pub fn gofile_api_status(status: &str) -> String {
    match status {
        "error-notFound" => {
            "El archivo o carpeta ya no existe en Gofile, o el enlace caducó. Pide un enlace nuevo al proveedor.".into()
        }
        "error-rateLimit" => {
            "Gofile limitó las peticiones. Espera unos minutos o prueba con VPN.".into()
        }
        "error-notPremium" => {
            "Gofile denegó el acceso (cuenta premium requerida para este contenido).".into()
        }
        "error-passwordRequired" => {
            "Este enlace de Gofile está protegido con contraseña.".into()
        }
        "error-passwordWrong" => "La contraseña del enlace de Gofile es incorrecta.".into(),
        "error-wrongToken" | "error-notAuthenticated" => {
            "La sesión con Gofile expiró. Vuelve a intentar la descarga.".into()
        }
        other => format!("Gofile respondió con error: {other}."),
    }
}

pub fn gofile_folder_empty() -> String {
    "La carpeta de Gofile está vacía o los archivos ya fueron eliminados. Pide un enlace nuevo."
        .into()
}

pub fn gofile_unreachable() -> String {
    "No se pudo conectar con Gofile. Si gofile.io no abre en el navegador (común en Colombia y otras regiones), activa VPN e inténtalo de nuevo.".into()
}

pub fn gofile_timeout() -> String {
    "Gofile tardó demasiado en responder. Si la web no carga sin VPN, actívala e inténtalo de nuevo.".into()
}

pub fn gofile_html_instead_of_json() -> String {
    "Gofile devolvió una página web en lugar de datos (bloqueo regional o mantenimiento). Comprueba que https://gofile.io abre en el navegador; si no, usa VPN.".into()
}

pub fn gofile_http_not_found() -> String {
    "El archivo ya no está en Gofile (HTTP 404). El enlace puede haber caducado o haber sido borrado.".into()
}

pub fn map_json_error(e: reqwest::Error, hoster: &str) -> HosterError {
    if e.is_decode() {
        let msg = if hoster.eq_ignore_ascii_case("gofile") {
            gofile_html_instead_of_json()
        } else if hoster.contains("viking") {
            "VikingFile devolvió una página de protección en lugar de datos (Cloudflare/CAPTCHA)."
                .into()
        } else {
            format!(
                "{hoster}: el servidor devolvió una página web en lugar de JSON (¿Cloudflare o servicio caído?)"
            )
        };
        HosterError::ResolutionFailed(msg)
    } else {
        HosterError::Network(e)
    }
}

fn host_from_uri(uri: &str) -> String {
    reqwest::Url::parse(uri)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
        .unwrap_or_default()
}

fn network_user_message(err: &reqwest::Error, host: &str) -> String {
    let is_gofile = host.contains("gofile");
    let is_viking = host.contains("vikingfile") || host.contains("vik1ngfile");

    if err.is_decode() {
        if is_gofile {
            return gofile_html_instead_of_json();
        }
        if is_viking {
            return "VikingFile devolvió una página de protección (Cloudflare/CAPTCHA), no datos válidos.".into();
        }
        return "El hoster devolvió una página web en lugar de datos válidos. Abre el enlace en el navegador.".into();
    }
    if err.is_timeout() {
        if is_gofile {
            return gofile_timeout();
        }
        return "El hoster no respondió a tiempo. Si su web no carga en el navegador, puede estar bloqueada en tu red.".into();
    }
    if err.is_connect() {
        if is_gofile {
            return gofile_unreachable();
        }
        return "No se pudo conectar con el hoster. Comprueba tu red o que el enlace abre en el navegador.".into();
    }
    if is_gofile {
        return format!("Error de red con Gofile: {err}");
    }
    format!("Error de red: {err}")
}

fn polish_gofile_resolution(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if lower.contains("sin enlaces de archivo")
        || lower.contains("carpeta") && lower.contains("vac")
    {
        return gofile_folder_empty();
    }
    if lower.contains("error-notfound") || lower.contains("no existe") {
        return gofile_api_status("error-notFound");
    }
    if lower.contains("tiempo de espera agotado") || lower.contains("90s") {
        return gofile_timeout();
    }
    if lower.contains("página web en lugar de json") || lower.contains("cloudflare/captcha") {
        return gofile_html_instead_of_json();
    }
    if lower.contains("límite de peticiones") || lower.contains("429") {
        return gofile_api_status("error-rateLimit");
    }
    if lower.contains("http 404") || lower.contains("archivo no encontrado") {
        return gofile_http_not_found();
    }
    message.to_string()
}

impl HosterError {
    /// Mensaje para la UI según el hoster del enlace original.
    pub fn to_user_string_for_uri(&self, uri: &str) -> String {
        let host = host_from_uri(uri);
        let is_gofile = host.contains("gofile");

        match self {
            HosterError::Network(err) => network_user_message(err, &host),
            HosterError::ResolutionFailed(msg) if is_gofile => polish_gofile_resolution(msg),
            HosterError::ResolutionFailed(msg) if msg.starts_with("gofile:") => {
                polish_gofile_resolution(msg.strip_prefix("gofile:").unwrap_or(msg))
            }
            HosterError::ResolutionFailed(msg) => msg.clone(),
            HosterError::InvalidUrl(url) => format!("URL inválida: {url}"),
            HosterError::Http(code) => {
                if is_gofile && *code == 404 {
                    gofile_http_not_found()
                } else {
                    format!("Error HTTP {code}")
                }
            }
        }
    }
}
