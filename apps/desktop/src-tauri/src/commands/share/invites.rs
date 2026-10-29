use crate::cloud::api_error::ensure_success;
use crate::cloud::cloud_api;
use crate::config;
use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::command;

const INVITE_TOKEN_LENGTH: usize = 48;

fn validate_invite_token(token: &str) -> AppResult<()> {
    if token.len() == INVITE_TOKEN_LENGTH
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(AppError::new(
            "INVALID_ARGUMENT",
            "El código de invitación no es válido.",
        ))
    }
}

fn invite_bootstrap_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| AppError::network())
}

fn parse_invite_url(invite_url: &str) -> AppResult<(String, String)> {
    let trimmed = invite_url.trim();
    let marker = "/invites/accept/";
    let mut parsed_url = url::Url::parse(trimmed).map_err(|_| {
        AppError::new(
            "INVALID_ARGUMENT",
            "El enlace no tiene un formato de invitación válido.",
        )
    })?;

    if !matches!(parsed_url.scheme(), "http" | "https")
        || parsed_url.host_str().is_none()
        || !parsed_url.username().is_empty()
        || parsed_url.password().is_some()
    {
        return Err(AppError::new(
            "INVALID_ARGUMENT",
            "El enlace debe usar HTTP o HTTPS y no puede incluir credenciales.",
        ));
    }

    let path = parsed_url.path();
    let idx = path.rfind(marker).ok_or_else(|| {
        AppError::new(
            "INVALID_ARGUMENT",
            "El enlace no tiene un formato de invitación válido.",
        )
    })?;
    let base_path = path[..idx].to_string();
    let token = path[idx + marker.len()..].trim_end_matches('/').to_string();
    validate_invite_token(&token)?;

    // El endpoint de bootstrap no usa API key. Limpia cualquier dato no necesario
    // del enlace y conserva solo el origen y el prefijo de ruta del servidor invitante.
    parsed_url.set_path(&base_path);
    parsed_url.set_query(None);
    parsed_url.set_fragment(None);
    let base_url = normalize_base_url(parsed_url.as_str());
    Ok((base_url, token))
}

fn is_local_net(s: &str) -> bool {
    let cleaned = s
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("wss://")
        .trim_start_matches("ws://");

    let host = cleaned
        .split(':')
        .next()
        .unwrap_or("")
        .split('/')
        .next()
        .unwrap_or("")
        .trim();

    if host.is_empty() {
        return false;
    }

    if host == "localhost"
        || host == "127.0.0.1"
        || host == "0.0.0.0"
        || host.ends_with(".local")
        || host.ends_with(".lan")
    {
        return true;
    }

    if host.starts_with("192.168.") || host.starts_with("10.") {
        return true;
    }

    // 172.16.0.0 - 172.31.255.255 (Docker / Clase B privada)
    for b in 16..=31 {
        if host.starts_with(&format!("172.{}.", b)) {
            return true;
        }
    }

    // 100.64.0.0 - 100.127.255.255 (Tailscale / CGNAT)
    for b in 64..=127 {
        if host.starts_with(&format!("100.{}.", b)) {
            return true;
        }
    }

    false
}

pub fn normalize_base_url(input: &str) -> String {
    let s = input.trim().trim_end_matches('/').to_string();
    if s.is_empty() {
        return s;
    }

    if is_local_net(&s) {
        if s.starts_with("https://") {
            return format!("http://{}", s.trim_start_matches("https://"));
        }
        if !s.starts_with("http://") {
            return format!("http://{}", s);
        }
        return s;
    }

    if s.starts_with("https://") || s.starts_with("http://") {
        return s;
    }
    format!("http://{}", s)
}

pub fn normalize_ws_url(input: &str) -> String {
    let s = input.trim().trim_end_matches('/').to_string();
    if s.is_empty() {
        return s;
    }

    if is_local_net(&s) {
        if s.starts_with("wss://") {
            return format!("ws://{}", s.trim_start_matches("wss://"));
        }
        if s.starts_with("https://") {
            return format!("ws://{}", s.trim_start_matches("https://"));
        }
        if s.starts_with("http://") {
            return format!("ws://{}", s.trim_start_matches("http://"));
        }
        if s.starts_with("ws://") {
            return s;
        }
        return format!("ws://{}", s);
    }

    if s.starts_with("ws://") || s.starts_with("wss://") {
        return s;
    }
    if s.starts_with("https://") {
        return format!("wss://{}", s.trim_start_matches("https://"));
    }
    if s.starts_with("http://") {
        return format!("ws://{}", s.trim_start_matches("http://"));
    }
    format!("ws://{}", s)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptInviteProvisionResponseDto {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub access_token_expires_at: Option<u64>,
    pub refresh_token_expires_at: Option<u64>,
    pub api_url: Option<String>,
    pub ws_url: Option<String>,
    pub host_user_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudInviteDto {
    pub id: String,
    pub host_user_id: String,
    pub invitee_user_id: Option<String>,
    pub token: Option<String>,
    pub invite_url: Option<String>,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub expires_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInvitesResponseDto {
    pub items: Vec<CloudInviteDto>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudMembershipDto {
    pub host_user_id: String,
    pub member_user_id: String,
    pub invited_by_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub active: bool,
    #[serde(default)]
    pub scheduled_deletion_at: Option<String>,
    #[serde(default)]
    pub scheduled_deletion_by: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudMembershipsResponseDto {
    pub host_memberships: Vec<CloudMembershipDto>,
    pub member_memberships: Vec<CloudMembershipDto>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudPresenceDto {
    pub user_id: String,
    pub status: String,
    pub game_id: Option<String>,
    pub game_name: Option<String>,
    pub connection_count: u32,
    pub last_seen_at: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudPresenceResponseDto {
    pub items: Vec<CloudPresenceDto>,
}

fn persist_cloud_invite_provision(
    base_url: &str,
    parsed: AcceptInviteProvisionResponseDto,
) -> Result<(), String> {
    let mut next = config::load_settings();

    let resolved_host_api_url = base_url.trim_end_matches('/').to_string();
    next.cloud_host_api_base_urls
        .insert(parsed.host_user_id.clone(), resolved_host_api_url);

    if let Some(ws_url) = parsed.ws_url {
        let ws = ws_url.trim();
        if !ws.is_empty() {
            next.cloud_host_ws_base_urls
                .insert(parsed.host_user_id.clone(), ws.to_string());
        }
    }

    next.active_cloud_host_user_id = Some(parsed.host_user_id);

    config::set_secure_api_key_for_cloud_host(
        next.active_cloud_host_user_id
            .as_deref()
            .unwrap_or_default(),
        parsed.access_token.as_str(),
    )?;
    if let Some(refresh_token) = parsed.refresh_token.as_deref() {
        config::set_secure_refresh_token_for_cloud_host(
            next.active_cloud_host_user_id
                .as_deref()
                .unwrap_or_default(),
            refresh_token,
        )?;
    }

    config::save_settings(&next)
}

/// Crea una nueva invitación para unirse a la nube personal.
///
/// # Arguments
///
/// * `invitee_user_id` - Identificador de usuario opcional para limitar la invitación a un destinatario específico.
/// * `with_token` - Indica si se debe generar un token transferible para el acceso.
/// * `expires_in_days` - Tiempo de expiración de la invitación en días.
///
/// # Returns
///
/// Estructura [`CloudInviteDto`] con los datos de la invitación creada.
///
/// # Errors
///
/// Devuelve [`AppError`] si falla la serialización, la comunicación de red o el servidor responde con error.
#[command]
pub async fn create_cloud_invite(
    invitee_user_id: Option<String>,
    with_token: Option<bool>,
    expires_in_days: Option<u32>,
) -> AppResult<CloudInviteDto> {
    let mut payload = serde_json::Map::new();
    payload.insert(
        "withToken".to_string(),
        serde_json::Value::Bool(with_token.unwrap_or(true)),
    );
    payload.insert(
        "expiresInDays".to_string(),
        serde_json::Value::Number(serde_json::Number::from(expires_in_days.unwrap_or(7))),
    );
    if let Some(invitee) = invitee_user_id
        .map(|x| x.trim().to_string())
        .filter(|x| !x.is_empty())
    {
        payload.insert(
            "inviteeUserId".to_string(),
            serde_json::Value::String(invitee),
        );
    }

    let settings = config::load_settings();
    if let Some(ws_url) = settings
        .ws_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        payload.insert(
            "wsUrl".to_string(),
            serde_json::Value::String(ws_url.to_string()),
        );
    }

    let response = cloud_api(reqwest::Method::POST, "/invites")
        .for_owner()
        .json(&serde_json::Value::Object(payload))
        .map_err(|e| AppError::new("SERIALIZATION_ERROR", e))?
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;

    ensure_success(response)
        .await?
        .json::<CloudInviteDto>()
        .await
        .map_err(|_| {
            AppError::new(
                "INVALID_RESPONSE",
                "El servidor devolvió una respuesta inválida.",
            )
        })
}

/// Obtiene la lista de invitaciones pendientes para la nube activa.
///
/// # Returns
///
/// Vector de [`CloudInviteDto`] con las invitaciones recibidas pendientes de respuesta.
///
/// # Errors
///
/// Devuelve [`AppError`] si falla la petición HTTP o la deserialización de la respuesta.
#[command]
pub async fn list_pending_cloud_invites() -> AppResult<Vec<CloudInviteDto>> {
    let response = cloud_api(reqwest::Method::GET, "/invites/pending")
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;
    let parsed = ensure_success(response)
        .await?
        .json::<PendingInvitesResponseDto>()
        .await
        .map_err(|_| {
            AppError::new(
                "INVALID_RESPONSE",
                "El servidor devolvió una respuesta inválida.",
            )
        })?;
    Ok(parsed.items)
}

/// Responde a una invitación de nube aceptándola o rechazándola.
///
/// # Arguments
///
/// * `invite_id` - Identificador único de la invitación a responder.
/// * `action` - Acción a ejecutar (`accept` o `reject`).
///
/// # Returns
///
/// `Ok(())` si la respuesta fue aceptada por el servidor.
///
/// # Errors
///
/// Devuelve [`AppError`] si la petición falla o el servidor retorna un error de negocio.
#[command]
pub async fn respond_cloud_invite(invite_id: String, action: String) -> AppResult<()> {
    let payload = serde_json::json!({ "action": action.trim() });
    let response = cloud_api(reqwest::Method::POST, &format!("/invites/{}/respond", invite_id.trim()))
        .json(&payload)
        .map_err(|e| AppError::new("SERIALIZATION_ERROR", e))?
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;
    ensure_success(response).await?;
    Ok(())
}

/// Acepta una invitación a una nube compartida mediante un token de invitación.
///
/// # Arguments
///
/// * `token` - Token hexadecimal de invitación.
///
/// # Returns
///
/// `Ok(())` si la provisión de membresía fue procesada y almacenada correctamente.
///
/// # Errors
///
/// Devuelve [`AppError`] si el token es inválido o la API rechaza la solicitud.
#[command]
pub async fn accept_cloud_invite_by_token(token: String) -> AppResult<()> {
    validate_invite_token(token.trim())?;
    let payload = serde_json::json!({ "token": token.trim() });
    let response = cloud_api(reqwest::Method::POST, "/invites/accept-token")
        .json(&payload)
        .map_err(|e| AppError::new("SERIALIZATION_ERROR", e))?
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;
    let response = ensure_success(response).await?;
    let parsed = response
        .json::<AcceptInviteProvisionResponseDto>()
        .await
        .map_err(|_| {
            AppError::new(
                "INVALID_RESPONSE",
                "El servidor devolvió una respuesta inválida.",
            )
        })?;

    let settings = config::load_settings();
    let base_url = if let Some(active_host) = settings
        .active_cloud_host_user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
    {
        settings
            .cloud_host_api_base_urls
            .get(active_host)
            .cloned()
            .unwrap_or_default()
    } else {
        settings.api_base_url.clone().unwrap_or_default()
    };

    persist_cloud_invite_provision(&base_url, parsed)?;
    Ok(())
}

/// Acepta una invitación a una nube compartida a partir de su URL pública.
///
/// # Arguments
///
/// * `invite_url` - Cadena con la URL completa de invitación.
///
/// # Returns
///
/// `Ok(())` si la provisión fue completada con éxito.
///
/// # Errors
///
/// Devuelve [`AppError`] si el usuario no está configurado, la URL es inválida o la API falla.
#[command]
pub async fn accept_cloud_invite_by_url(invite_url: String) -> AppResult<()> {
    let settings = config::load_settings();
    let user_id = settings
        .user_id
        .as_deref()
        .ok_or("Usuario no configurado")?
        .trim()
        .to_string();

    let (base_url, token) = parse_invite_url(&invite_url)?;

    let endpoint = format!("{}/invites/accept-token", base_url);
    let payload = serde_json::json!({ "token": token });

    let bootstrap_client = invite_bootstrap_client()?;
    let response = bootstrap_client
        .post(&endpoint)
        .header("x-user-id", user_id)
        .json(&payload)
        .send()
        .await
        .map_err(|_| AppError::network())?;

    let response = ensure_success(response).await?;

    let parsed = response
        .json::<AcceptInviteProvisionResponseDto>()
        .await
        .map_err(|_| {
            AppError::new(
                "INVALID_RESPONSE",
                "El servidor devolvió una respuesta inválida.",
            )
        })?;

    persist_cloud_invite_provision(&base_url, parsed)?;

    Ok(())
}

/// Abandona la membresía en la nube de un anfitrión específico y limpia sus recursos locales.
///
/// # Arguments
///
/// * `host_user_id` - Identificador de usuario del anfitrión de la nube.
///
/// # Returns
///
/// `Ok(())` si la membresía fue revocada con éxito.
///
/// # Errors
///
/// Devuelve [`AppError`] si el anfitrión es inválido o la API rechaza la solicitud.
#[command]
pub async fn leave_cloud_membership(host_user_id: String) -> AppResult<()> {
    let host = host_user_id.trim().to_string();
    if host.is_empty() {
        return Err("Host inválido".into());
    }

    let settings = config::load_settings();
    let user_id = settings
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Usuario no configurado")?;

    let payload = serde_json::json!({
        "hostUserId": host,
        "memberUserId": user_id,
    });
    let response = cloud_api(reqwest::Method::POST, "/invites/memberships/leave")
        .for_host(&host)
        .json(&payload)
        .map_err(|e| AppError::new("SERIALIZATION_ERROR", e))?
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;
    ensure_success(response).await?;

    config::clean_up_cloud_host(&host)?;

    Ok(())
}

/// Remueve a un miembro de la nube propia administrada por el usuario.
///
/// # Arguments
///
/// * `member_user_id` - Identificador de usuario del miembro a expulsar.
///
/// # Returns
///
/// `Ok(())` si el miembro fue removido con éxito en el servidor.
///
/// # Errors
///
/// Devuelve [`AppError`] si el usuario local no está configurado o la solicitud falla.
#[command]
pub async fn remove_cloud_member(member_user_id: String) -> AppResult<()> {
    let settings = config::load_settings();
    let user_id = settings
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Usuario no configurado")?;

    let payload = serde_json::json!({
      "hostUserId": user_id,
      "memberUserId": member_user_id.trim(),
    });
    let response = cloud_api(reqwest::Method::POST, "/invites/memberships/remove")
        .for_owner()
        .json(&payload)
        .map_err(|e| AppError::new("SERIALIZATION_ERROR", e))?
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;
    ensure_success(response).await?;
    Ok(())
}

/// Cancela una eliminación programada de un miembro de la nube compartida.
///
/// # Errors
///
/// Devuelve [`AppError`] si el usuario local no está configurado o la solicitud falla.
#[command]
pub async fn cancel_cloud_member_deletion(member_user_id: String) -> AppResult<()> {
    let settings = config::load_settings();
    let user_id = settings
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Usuario no configurado")?;

    let payload = serde_json::json!({
      "hostUserId": user_id,
      "memberUserId": member_user_id.trim(),
    });
    let response = cloud_api(reqwest::Method::POST, "/invites/memberships/cancel-removal")
        .for_owner()
        .json(&payload)
        .map_err(|e| AppError::new("SERIALIZATION_ERROR", e))?
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;
    ensure_success(response).await?;
    Ok(())
}

/// Obtiene el listado consolidado de membresías tanto de la nube propia como de nubes anfitrionas.
///
/// # Returns
///
/// Estructura [`CloudMembershipsResponseDto`] con las listas de anfitrión e invitado.
///
/// # Errors
///
/// Devuelve [`AppError`] si el identificador de usuario local no está configurado.
#[command]
pub async fn list_cloud_memberships() -> AppResult<CloudMembershipsResponseDto> {
    let settings = config::load_settings();
    let user_id = settings
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Usuario no configurado")?
        .to_string();

    let mut host_memberships: Vec<CloudMembershipDto> = vec![];
    let mut member_memberships: Vec<CloudMembershipDto> = vec![];

    if settings.api_base_url.is_some() && settings.api_key.is_some() {
        if let Ok(response) = cloud_api(reqwest::Method::GET, "/invites/memberships")
            .for_owner()
            .send()
            .await
        {
            if let Ok(res) = ensure_success(response).await {
                if let Ok(parsed) = res.json::<CloudMembershipsResponseDto>().await {
                    host_memberships = parsed.host_memberships;
                }
            }
        }
    }

    let host_ids: Vec<String> = settings.cloud_host_api_base_urls.keys().cloned().collect();
    for host in host_ids {
        let req_res = cloud_api(reqwest::Method::GET, "/invites/memberships")
            .for_host(&host)
            .send()
            .await;
        let response = match req_res {
            Ok(res) => res,
            Err(_) => {
                let _ = config::clean_up_cloud_host(&host);
                continue;
            }
        };
        if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
            let _ = config::clean_up_cloud_host(&host);
            continue;
        }
        let parsed = match ensure_success(response).await {
            Ok(res) => match res.json::<CloudMembershipsResponseDto>().await {
                Ok(p) => p,
                Err(_) => continue,
            },
            Err(_) => continue,
        };
        let is_active = parsed
            .member_memberships
            .iter()
            .any(|m| m.host_user_id == host && m.member_user_id == user_id && m.active);
        if is_active {
            member_memberships.extend(parsed.member_memberships);
        } else {
            let _ = config::clean_up_cloud_host(&host);
        }
    }

    Ok(CloudMembershipsResponseDto {
        host_memberships,
        member_memberships,
    })
}

/// Consulta los estados de presencia de los miembros conectados en la nube activa.
///
/// # Returns
///
/// Vector con la presencia de cada miembro (`Vec<CloudPresenceDto>`).
///
/// # Errors
///
/// Devuelve [`AppError`] si la petición falla o la respuesta no puede deserializarse.
#[command]
pub async fn list_cloud_presence() -> AppResult<Vec<CloudPresenceDto>> {
    let response = cloud_api(reqwest::Method::GET, "/invites/presence")
        .send()
        .await
        .map_err(|e| AppError::new("NETWORK_ERROR", e))?;

    let parsed = ensure_success(response)
        .await?
        .json::<CloudPresenceResponseDto>()
        .await
        .map_err(|_| {
            AppError::new(
                "INVALID_RESPONSE",
                "El servidor devolvió una respuesta inválida.",
            )
        })?;

    Ok(parsed.items)
}

#[cfg(test)]
mod invite_token_tests {
    use super::{parse_invite_url, validate_invite_token};

    const VALID_TOKEN: &str = "5571a1ade6ee46173aa026bd6c22a6e65a7a11ca9c4b7740";

    #[test]
    fn accepts_only_generated_hex_tokens() {
        assert!(validate_invite_token(VALID_TOKEN).is_ok());
        assert!(validate_invite_token(&format!("{VALID_TOKEN}https://localhost:3000")).is_err());
    }

    #[test]
    fn extracts_token_and_ignores_query_and_fragment() {
        let (base_url, token) = parse_invite_url(&format!(
            "https://cloud.example/invites/accept/{VALID_TOKEN}?source=copy#{VALID_TOKEN}"
        ))
        .expect("a well-formed invite URL should be accepted");

        assert_eq!(base_url, "https://cloud.example");
        assert_eq!(token, VALID_TOKEN);
    }

    #[test]
    fn rejects_concatenated_invite_urls() {
        let malformed = format!(
            "https://cloud.example/invites/accept/{VALID_TOKEN}https://cloud.example/invites/accept/{VALID_TOKEN}"
        );
        assert!(parse_invite_url(&malformed).is_err());
    }
}
