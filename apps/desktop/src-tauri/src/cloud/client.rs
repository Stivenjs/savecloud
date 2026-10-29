//! Cliente HTTP unificado para el backend de SaveCloud.
//!
//! Centraliza la comunicación con la API remota gestionando resolución de credenciales,
//! validación preventiva de sesiones de invitado y reintentos exponenciales con jitter.

use std::time::{Duration, Instant};
use reqwest::header::{HeaderMap, RETRY_AFTER};
use crate::network::API_CLIENT;
use crate::observability;

const BASE_RETRY_DELAY: Duration = Duration::from_millis(500);
const MAX_BACKOFF: Duration = Duration::from_secs(8);
const SERVER_DELAY_JITTER_MS: u64 = 250;

/// Calcula el intervalo de espera exponencial aleatorizado con jitter para reintentos.
///
/// Si la respuesta HTTP incluye la cabecera `Retry-After`, se respeta dicho valor mínimo
/// sumando un margen de dispersión adicional para evitar sincronización de clientes.
///
/// # Arguments
///
/// * `retry_index` - Índice del reintento actual (base 0).
/// * `headers` - Cabeceras de la respuesta HTTP previa, utilizadas para extraer `Retry-After`.
///
/// # Returns
///
/// Duración calculada que debe pausarse antes del siguiente intento.
fn calculate_retry_delay(retry_index: u32, headers: Option<&HeaderMap>) -> Duration {
    let exponent = retry_index.min(4);
    let backoff_cap = BASE_RETRY_DELAY
        .saturating_mul(1_u32 << exponent)
        .min(MAX_BACKOFF);

    let random_jitter = Duration::from_millis(rand::random::<u64>() % (backoff_cap.as_millis() as u64 + 1));
    let server_delay = headers.and_then(parse_retry_after).unwrap_or_default();

    if server_delay.is_zero() {
        random_jitter
    } else {
        server_delay.max(random_jitter)
            + Duration::from_millis(rand::random::<u64>() % (SERVER_DELAY_JITTER_MS + 1))
    }
}

/// Extrae y analiza la cabecera HTTP `Retry-After`.
///
/// Soporta formatos en segundos enteros y marcas de tiempo RFC-2822.
///
/// # Arguments
///
/// * `headers` - Mapa de cabeceras HTTP de la respuesta.
///
/// # Returns
///
/// `Some(Duration)` si la cabecera está presente y es válida; de lo contrario `None`.
fn parse_retry_after(headers: &HeaderMap) -> Option<Duration> {
    let value = headers.get(RETRY_AFTER)?.to_str().ok()?.trim();

    if let Ok(seconds) = value.parse::<u64>() {
        return Some(Duration::from_secs(seconds));
    }

    let retry_at = chrono::DateTime::parse_from_rfc2822(value).ok()?;
    let delay = retry_at.signed_duration_since(chrono::Utc::now());
    delay.to_std().ok()
}

/// Determina si una combinación de método y ruta es idempotente o segura para reintentar.
///
/// # Arguments
///
/// * `method` - Método HTTP de la solicitud (`GET`, `POST`, etc.).
/// * `path` - Ruta del endpoint solicitado.
///
/// # Returns
///
/// `true` si la solicitud puede ser reintentada sin efectos colaterales; `false` en caso contrario.
fn is_safe_to_retry(method: &reqwest::Method, path: &str) -> bool {
    if method == reqwest::Method::GET || method == reqwest::Method::HEAD {
        return true;
    }

    if method == reqwest::Method::POST {
        return matches!(
            path,
            "/saves/upload-urls"
                | "/saves/download-urls"
                | "/saves/download-url"
                | "/saves/multipart/part-urls"
                | "/upload-urls"
                | "/download-urls"
                | "/download-url"
                | "/multipart/part-urls"
                | "/invites/pending"
                | "/clips/upload-url"
        ) || path.starts_with("/inventory/transfer-sessions/pending");
    }

    false
}

/// Evalúa si el código de estado HTTP recibido corresponde a una condición transitoria.
///
/// # Arguments
///
/// * `status` - Código de estado HTTP de la respuesta.
///
/// # Returns
///
/// `true` para estados 408, 429 y errores de servidor 5xx recuperables; `false` para errores definitivos.
fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 408 | 429 | 500 | 502 | 503 | 504)
}

/// Constructor de solicitudes HTTP para la API de SaveCloud con soporte para sesiones y reintentos.
pub struct CloudRequest<'a> {
    method: reqwest::Method,
    path: &'a str,
    target_host: Option<&'a str>,
    force_owner: bool,
    body: Option<Vec<u8>>,
    if_none_match: Option<&'a str>,
}

impl<'a> CloudRequest<'a> {
    /// Inicializa una nueva solicitud dirigida a la API.
    ///
    /// # Arguments
    ///
    /// * `method` - Método HTTP a ejecutar.
    /// * `path` - Endpoint relativo de la API (con o sin barra inicial).
    ///
    /// # Returns
    ///
    /// Instancia configurada de [`CloudRequest`].
    pub fn new(method: reqwest::Method, path: &'a str) -> Self {
        Self {
            method,
            path,
            target_host: None,
            force_owner: false,
            body: None,
            if_none_match: None,
        }
    }

    /// Asigna un anfitrión de nube compartida específico como destinatario de la petición.
    ///
    /// # Arguments
    ///
    /// * `host_user_id` - Identificador de usuario del anfitrión.
    ///
    /// # Returns
    ///
    /// Instancia modificada con el anfitrión destino asignado.
    pub fn for_host(mut self, host_user_id: &'a str) -> Self {
        self.target_host = Some(host_user_id);
        self
    }

    /// Fuerza el uso de las credenciales del propietario de la nube local,
    /// ignorando cualquier anfitrión activo configurado en modo invitado.
    ///
    /// # Returns
    ///
    /// Instancia modificada configurada para operar como propietario.
    pub fn for_owner(mut self) -> Self {
        self.force_owner = true;
        self
    }

    /// Adjunta la cabecera `If-None-Match` para validación condicional de caché basada en ETag.
    ///
    /// # Arguments
    ///
    /// * `etag` - Cadena ETag previa en caché.
    ///
    /// # Returns
    ///
    /// Instancia modificada con la cabecera de validación condicional.
    pub fn if_none_match(mut self, etag: Option<&'a str>) -> Self {
        self.if_none_match = etag;
        self
    }

    /// Serializa y adjunta un valor serializable como cuerpo JSON de la solicitud.
    ///
    /// # Arguments
    ///
    /// * `value` - Referencia a la estructura a serializar.
    ///
    /// # Returns
    ///
    /// `Ok(Self)` si la serialización es exitosa; `Err(String)` si falla la serialización JSON.
    ///
    /// # Errors
    ///
    /// Devuelve un error descriptivo si serde no puede serializar la estructura dada.
    pub fn json<T: serde::Serialize>(mut self, value: &T) -> Result<Self, String> {
        let bytes = serde_json::to_vec(value).map_err(|e| format!("Error al serializar cuerpo JSON: {e}"))?;
        self.body = Some(bytes);
        Ok(self)
    }

    /// Adjunta un vector de bytes directamente como cuerpo de la solicitud.
    ///
    /// # Arguments
    ///
    /// * `bytes` - Vector de bytes sin procesar.
    ///
    /// # Returns
    ///
    /// Instancia modificada con el cuerpo adjunto.
    #[allow(dead_code)]
    pub fn body_bytes(mut self, bytes: Vec<u8>) -> Self {
        self.body = Some(bytes);
        self
    }

    /// Adjunta una porción opcional de bytes como cuerpo de la solicitud.
    ///
    /// # Arguments
    ///
    /// * `bytes` - Slice opcional de bytes.
    ///
    /// # Returns
    ///
    /// Instancia modificada con el cuerpo opcional configurado.
    pub fn body_opt(mut self, bytes: Option<&[u8]>) -> Self {
        self.body = bytes.map(|b| b.to_vec());
        self
    }

    /// Despacha la solicitud HTTP a la red ejecutando autenticación, renovación preventiva y reintentos.
    ///
    /// # Returns
    ///
    /// `Ok(reqwest::Response)` con la respuesta del servidor si la comunicación fue exitosa.
    ///
    /// # Errors
    ///
    /// Devuelve `Err(String)` si la configuración de usuario falta, las credenciales no existen,
    /// o si todos los reintentos fallaron por agotamiento de tiempo de espera o errores de red.
    pub async fn send(self) -> Result<reqwest::Response, String> {
        let settings = crate::config::load_settings();

        let active_host = if self.force_owner {
            None
        } else {
            self.target_host
                .map(|h| h.trim())
                .filter(|h| !h.is_empty())
                .map(|h| h.to_string())
                .or_else(|| {
                    settings
                        .active_cloud_host_user_id
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                })
        };

        let (base_url, api_key, user_id) = if let Some(ref host) = active_host {
            let host_base_raw = settings
                .cloud_host_api_base_urls
                .get(host)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .ok_or_else(|| format!("La nube de {host} no tiene URL base configurada."))?;
            let base_url = crate::commands::share::invites::normalize_base_url(host_base_raw);

            // Validar de forma single-flight y atómica el token para este host específico
            crate::cloud::session_refresh::refresh_guest_session_single_flight(host, &base_url, 15).await?;

            let host_api_key = crate::config::get_secure_api_key_for_cloud_host(host)
                .ok_or_else(|| format!("No hay credenciales guardadas para la nube de {host}."))?;

            let user_id = settings
                .user_id
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or("Configura tu usuario en Configuración")?
                .to_string();

            (base_url, host_api_key, user_id)
        } else {
            let base_url_raw = settings
                .api_base_url
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or("Configura URL de la API en Configuración")?;
            let base_url = crate::commands::share::invites::normalize_base_url(base_url_raw);

            let api_key = settings
                .api_key
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or("Configura tu clave de acceso (apiKey)")?
                .to_string();

            let user_id = settings
                .user_id
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or("Configura tu usuario en Configuración")?
                .to_string();

            (base_url, api_key, user_id)
        };

        let normalized_path = if self.path.starts_with('/') {
            self.path.to_string()
        } else {
            format!("/{}", self.path)
        };
        let full_url = format!("{}{}", base_url.trim_end_matches('/'), normalized_path);

        let retry_safe = is_safe_to_retry(&self.method, self.path);
        let max_attempts = if retry_safe { 3 } else { 1 };

        for attempt in 0..max_attempts {
            let mut req = API_CLIENT
                .request(self.method.clone(), &full_url)
                .header("x-user-id", &user_id)
                .header("x-api-key", &api_key);

            if let Some(ref host) = active_host {
                req = req.header("x-cloud-host-user-id", host);
            }

            if let Some(etag) = self.if_none_match {
                req = req.header("If-None-Match", etag);
            }

            if let Some(ref body) = self.body {
                req = req
                    .header("Content-Type", "application/json")
                    .body(body.clone());
            }

            let start = Instant::now();
            let response = match req.send().await {
                Ok(res) => res,
                Err(error) => {
                    let can_retry = retry_safe
                        && attempt + 1 < max_attempts
                        && (error.is_timeout() || error.is_connect());

                    if can_retry {
                        let delay = calculate_retry_delay(attempt, None);
                        tokio::time::sleep(delay).await;
                        continue;
                    }

                    observability::record_error("sync_api_send", &error.to_string(), None);
                    return Err(crate::cloud::api_error::network_message());
                }
            };

            if retry_safe
                && attempt + 1 < max_attempts
                && is_retryable_status(response.status())
            {
                let delay = calculate_retry_delay(attempt, Some(response.headers()));
                tokio::time::sleep(delay).await;
                continue;
            }

            let elapsed_ms = start.elapsed().as_millis() as u64;
            let status = response.status();
            let is_ok = status.is_success() || status == reqwest::StatusCode::NOT_MODIFIED;

            observability::record_saves_api_timing(elapsed_ms, is_ok, self.path);

            if !is_ok {
                let status_code = status.as_u16();
                observability::record_error(
                    "sync_api_http",
                    &format!("path={} status={}", self.path, status_code),
                    Some(status_code),
                );
            }

            return Ok(response);
        }

        Err(crate::cloud::api_error::network_message())
    }
}

/// Construye una nueva solicitud hacia la API de SaveCloud.
///
/// # Arguments
///
/// * `method` - Método HTTP (`reqwest::Method::GET`, `POST`, etc.).
/// * `path` - Ruta del recurso dentro de la API.
///
/// # Returns
///
/// Instancia de [`CloudRequest`] lista para ser configurada y enviada.
pub fn cloud_api<'a>(method: reqwest::Method, path: &'a str) -> CloudRequest<'a> {
    CloudRequest::new(method, path)
}
