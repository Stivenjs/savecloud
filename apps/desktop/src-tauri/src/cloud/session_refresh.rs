use crate::commands::share::invites::normalize_base_url;
use crate::config;
use base64::Engine;
use rand::Rng;
use serde::Deserialize;
use std::sync::LazyLock;
use std::time::Duration;
use tauri::{Emitter, Manager};

use crate::network::API_CLIENT;

/// Margen de tiempo antes de la expiración a partir del cual se renueva
/// proactivamente el access token durante los ciclos periódicos.
///
/// Un margen de 15 minutos garantiza que el token siga siendo válido
/// si hay latencia de red o un reintenто de la tarea.
const PROACTIVE_REFRESH_MARGIN_SECS: u64 = 15 * 60;

/// Intervalo base entre ciclos de renovación periódica.
const BASE_REFRESH_INTERVAL: Duration = Duration::from_secs(5 * 60);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionTokensDto {
    access_token: String,
    refresh_token: String,
    host_user_id: String,
}

/// Aplica jitter aleatorio (±15 %) al intervalo de renovación para evitar
/// que múltiples clientes saturen la API simultáneamente (thundering herd).
fn next_refresh_interval() -> Duration {
    let jitter_factor: f64 = rand::thread_rng().gen_range(0.85..=1.15);
    let millis = (BASE_REFRESH_INTERVAL.as_millis() as f64 * jitter_factor).max(60_000.0);
    Duration::from_millis(millis as u64)
}

/// Arranca el ciclo de vida de renovación de sesiones de invitado.
///
/// # Fases
///
/// 1. **Startup (forzado):** renueva todos los tokens expirados o próximos a
///    expirar *antes* de que el frontend empiece a hacer peticiones, y emite el
///    evento `session-refreshed` para que el frontend pueda invalidar sus caches.
/// 2. **Periódico (con jitter):** renueva proactivamente cada ~5 minutos los
///    tokens que expiren en menos de [`PROACTIVE_REFRESH_MARGIN_SECS`].
///
/// El evento `session-refreshed` es fire-and-forget; si la ventana aún no está
/// disponible (arranque muy temprano), simplemente no se entrega.
pub fn start_session_refresh_task(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        refresh_expired_sessions().await;
        emit_session_refreshed(&app);

        loop {
            tokio::time::sleep(next_refresh_interval()).await;
            refresh_sessions_proactively().await;
        }
    });
}

/// Emite `session-refreshed` a la ventana principal del frontend.
///
/// Se usa después del refresh de startup para que TanStack Query invalide sus
/// caches y no sirva datos con un token obsoleto.
fn emit_session_refreshed(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if let Err(err) = window.emit("session-refreshed", ()) {
            log::warn!("[session_refresh] No se pudo emitir session-refreshed: {err}");
        }
    }
}

static GUEST_REFRESH_MUTEX: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Asegura que el token de la nube de invitado activa esté vigente antes de realizar
/// cualquier petición de red hacia el backend.
///
/// # Dueño de la nube vs Invitado
/// - Si el usuario actual es el **dueño de la nube** (`active_cloud_host_user_id` es `None`),
///   retorna inmediatamente `Ok(())` sin demoras, sin bloqueos y sin verificaciones de red.
/// - Si el usuario es un **invitado** (`active_cloud_host_user_id` es `Some`):
///   - Si su token `sc2` es válido y no expira en los próximos 15 segundos, retorna `Ok(())`.
///   - Si su token expiró o falta, adquiere un lock y renueva la sesión llamando a `/auth/refresh`
///     **ANTES** de permitir que la petición continúe, garantizando que el backend jamás reciba
///     un 401 por token vencido.
pub async fn ensure_active_guest_token_valid() -> Result<(), String> {
    let settings = config::load_settings();
    let Some(active_host) = settings
        .active_cloud_host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    else {

        return Ok(());
    };

    let base_url = match settings.cloud_host_api_base_urls.get(active_host) {
        Some(url) if !url.trim().is_empty() => normalize_base_url(url),
        _ => return Ok(()),
    };

    let current_access = config::get_secure_api_key_for_cloud_host(active_host);
    let is_valid = current_access
        .as_deref()
        .and_then(access_token_expiry)
        .is_some_and(|exp| exp > unix_now() + 15);

    if is_valid {
        return Ok(());
    }

    let _guard = GUEST_REFRESH_MUTEX.lock().await;

    let current_access = config::get_secure_api_key_for_cloud_host(active_host);
    if current_access
        .as_deref()
        .and_then(access_token_expiry)
        .is_some_and(|exp| exp > unix_now() + 15)
    {
        return Ok(());
    }

    log::info!("[session_refresh] Renovando token de invitado para {active_host} antes de despachar petición...");

    if let Some(refresh_token) = config::get_secure_refresh_token_for_cloud_host(active_host) {
        refresh_session(active_host, &base_url, &refresh_token).await?;
    } else if let Some(legacy_token) = current_access.filter(|t| t.starts_with("sc1.")) {
        upgrade_legacy_session(active_host, &base_url, &legacy_token).await?;
    }

    Ok(())
}

/// Renueva forzosamente todas las sesiones cuyos tokens hayan expirado o no
/// existan. No aplica ningún margen proactivo — es el modo de startup.
async fn refresh_expired_sessions() {
    for_each_cloud_host(|host, base_url, state| async move {
        match state {
            HostSessionState::HasRefreshToken { refresh_token, current_access } => {
                let token_still_valid = current_access
                    .as_deref()
                    .and_then(access_token_expiry)
                    .is_some_and(|exp| exp > unix_now());

                if token_still_valid {
                    // Token vigente: no hacer nada en startup para no gastar RTTs innecesarios.
                    Ok(())
                } else {
                    refresh_session(&host, &base_url, &refresh_token).await
                }
            }
            HostSessionState::LegacyToken(token) => {
                upgrade_legacy_session(&host, &base_url, &token).await
            }
        }
    })
    .await;
}

/// Renueva de forma proactiva los tokens que expiren pronto, usando el margen
/// configurado en [`PROACTIVE_REFRESH_MARGIN_SECS`].
async fn refresh_sessions_proactively() {
    for_each_cloud_host(|host, base_url, state| async move {
        match state {
            HostSessionState::HasRefreshToken { refresh_token, current_access } => {
                let still_fresh = current_access
                    .as_deref()
                    .and_then(access_token_expiry)
                    .is_some_and(|exp| exp > unix_now() + PROACTIVE_REFRESH_MARGIN_SECS);

                if still_fresh {
                    Ok(())
                } else {
                    refresh_session(&host, &base_url, &refresh_token).await
                }
            }
            HostSessionState::LegacyToken(token) => {
                upgrade_legacy_session(&host, &base_url, &token).await
            }
        }
    })
    .await;
}


enum HostSessionState {
    HasRefreshToken {
        refresh_token: String,
        current_access: Option<String>,
    },
    LegacyToken(String),
}

/// Itera sobre todas las nubes configuradas y aplica `action` a cada una,
/// registrando advertencias por las que fallen.
///
/// Usa `async_fn_traits`-style con un closure que retorna un `Future` para
/// mantener el código DRY sin duplicar la lógica de iteración.
async fn for_each_cloud_host<F, Fut>(action: F)
where
    F: Fn(String, String, HostSessionState) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let settings = config::load_settings();

    for (host_user_id, api_url) in settings.cloud_host_api_base_urls {
        let host = host_user_id.trim().to_owned();
        let base_url = normalize_base_url(&api_url);

        let current_access = config::get_secure_api_key_for_cloud_host(&host);

        let state = match config::get_secure_refresh_token_for_cloud_host(&host) {
            Some(refresh_token) => HostSessionState::HasRefreshToken {
                refresh_token,
                current_access,
            },
            None => match current_access {
                Some(token) if token.starts_with("sc1.") => HostSessionState::LegacyToken(token),
                _ => continue,
            },
        };

        if let Err(err) = action(host.clone(), base_url, state).await {
            log::warn!("[session_refresh] No se pudo renovar la sesión de la nube {host}: {err}");
        }
    }
}


/// Extrae el timestamp de expiración (`exp`) de un access token `sc2.*.*`.
/// Devuelve `None` si el token no es sc2 o tiene un payload malformado.
fn access_token_expiry(token: &str) -> Option<u64> {
    let mut parts = token.split('.');
    if parts.next()? != "sc2" {
        return None;
    }
    let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts.next()?)
        .ok()?;
    let claims = serde_json::from_slice::<serde_json::Value>(&payload).ok()?;
    claims.get("exp")?.as_u64()
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default()
}


async fn refresh_session(host: &str, base_url: &str, refresh_token: &str) -> Result<(), String> {
    let response = API_CLIENT
        .post(format!("{}/auth/refresh", base_url.trim_end_matches('/')))
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|err| format!("solicitud fallida: {err}"))?;

    let status = response.status();
    if !status.is_success() {
        // Si el servidor rechaza el refresh token como inválido, eliminamos el
        // access token local para que el usuario vea el error claramente en la UI.
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            let _ = config::delete_secure_api_key_for_cloud_host(host);
        }
        return Err(format!("el servidor respondió {status}"));
    }

    let tokens = response
        .json::<SessionTokensDto>()
        .await
        .map_err(|err| format!("respuesta de renovación inválida: {err}"))?;

    persist_tokens(host, tokens)
}

async fn upgrade_legacy_session(host: &str, base_url: &str, legacy_token: &str) -> Result<(), String> {
    let user_id = config::load_settings()
        .user_id
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "falta el ID local del usuario".to_string())?;

    let response = API_CLIENT
        .post(format!("{}/auth/upgrade", base_url.trim_end_matches('/')))
        .header("x-api-key", legacy_token)
        .header("x-user-id", user_id)
        .send()
        .await
        .map_err(|err| format!("solicitud de migración fallida: {err}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("el servidor respondió {status}"));
    }

    let tokens = response
        .json::<SessionTokensDto>()
        .await
        .map_err(|err| format!("respuesta de migración inválida: {err}"))?;

    persist_tokens(host, tokens)
}

fn persist_tokens(host: &str, tokens: SessionTokensDto) -> Result<(), String> {
    if tokens.host_user_id != host {
        return Err("el servidor devolvió una sesión para otra nube".into());
    }
    config::set_secure_api_key_for_cloud_host(host, &tokens.access_token)?;
    config::set_secure_refresh_token_for_cloud_host(host, &tokens.refresh_token)
}
