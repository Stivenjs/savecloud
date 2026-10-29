use crate::commands::share::invites::normalize_base_url;
use crate::config;
use base64::Engine;
use rand::Rng;
use serde::Deserialize;
use std::sync::LazyLock;
use std::time::Duration;

static SESSION_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .connect_timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("fallo al inicializar el cliente de renovación de sesión")
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionTokensDto {
    access_token: String,
    refresh_token: String,
    host_user_id: String,
}

const BASE_REFRESH_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Aplica jitter aleatorio (±15%) al intervalo de renovación para evitar
/// que múltiples clientes saturen la API simultáneamente (thundering herd).
fn next_refresh_interval() -> Duration {
    let mut rng = rand::thread_rng();
    let jitter_factor: f64 = rng.gen_range(0.85..=1.15);
    let millis = (BASE_REFRESH_INTERVAL.as_millis() as f64 * jitter_factor).max(60_000.0);
    Duration::from_millis(millis as u64)
}

/// Renueva tokens de invitado al arrancar y periódicamente con jitter mientras SaveCloud siga abierto.
pub fn start_session_refresh_task() {
    tauri::async_runtime::spawn(async move {
        refresh_all_guest_sessions().await;
        loop {
            tokio::time::sleep(next_refresh_interval()).await;
            refresh_all_guest_sessions().await;
        }
    });
}

async fn refresh_all_guest_sessions() {
    let settings = config::load_settings();
    for (host_user_id, api_url) in settings.cloud_host_api_base_urls {
        let host = host_user_id.trim();
        let base_url = normalize_base_url(&api_url);
        let current_access = config::get_secure_api_key_for_cloud_host(host);
        let result = if let Some(refresh_token) = config::get_secure_refresh_token_for_cloud_host(host) {
            if current_access
                .as_deref()
                .and_then(access_token_expiry)
                .is_some_and(|expires| expires > unix_now() + 15 * 60)
            {
                Ok(())
            } else {
                refresh_session(host, &base_url, &refresh_token).await
            }
        } else if let Some(legacy_token) = current_access {
            if legacy_token.starts_with("sc1.") {
                upgrade_legacy_session(host, &base_url, &legacy_token).await
            } else {
                Ok(())
            }
        } else {
            continue;
        };

        if let Err(error) = result {
            log::warn!("No se pudo renovar la sesión de la nube {host}: {error}");
        }
    }
}

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
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

async fn refresh_session(host: &str, base_url: &str, refresh_token: &str) -> Result<(), String> {
    let response = SESSION_CLIENT
        .post(format!("{}/auth/refresh", base_url.trim_end_matches('/')))
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .await
        .map_err(|error| format!("solicitud fallida: {error}"))?;
    if !response.status().is_success() {
        if response.status() == reqwest::StatusCode::UNAUTHORIZED
            || response.status() == reqwest::StatusCode::FORBIDDEN
        {
            config::delete_secure_api_key_for_cloud_host(host)?;
        }
        return Err(format!("el servidor respondió {}", response.status()));
    }
    let tokens = response
        .json::<SessionTokensDto>()
        .await
        .map_err(|error| format!("respuesta de renovación inválida: {error}"))?;
    persist_tokens(host, tokens)
}

async fn upgrade_legacy_session(host: &str, base_url: &str, legacy_token: &str) -> Result<(), String> {
    let user_id = config::load_settings()
        .user_id
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "falta el ID local del usuario".to_string())?;
    let response = SESSION_CLIENT
        .post(format!("{}/auth/upgrade", base_url.trim_end_matches('/')))
        .header("x-api-key", legacy_token)
        .header("x-user-id", user_id)
        .send()
        .await
        .map_err(|error| format!("solicitud de migración fallida: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("el servidor respondió {}", response.status()));
    }
    let tokens = response
        .json::<SessionTokensDto>()
        .await
        .map_err(|error| format!("respuesta de migración inválida: {error}"))?;
    persist_tokens(host, tokens)
}

fn persist_tokens(host: &str, tokens: SessionTokensDto) -> Result<(), String> {
    if tokens.host_user_id != host {
        return Err("el servidor devolvió una sesión para otra nube".into());
    }
    config::set_secure_api_key_for_cloud_host(host, &tokens.access_token)?;
    config::set_secure_refresh_token_for_cloud_host(host, &tokens.refresh_token)
}
