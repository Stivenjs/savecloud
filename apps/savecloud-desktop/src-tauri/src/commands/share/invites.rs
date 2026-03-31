use crate::config;
use crate::network::API_CLIENT;
use serde::{Deserialize, Serialize};
use tauri::command;

fn normalize_base_url(input: &str) -> String {
    let s = input.trim().trim_end_matches('/').to_string();
    if s.starts_with("https://") {
        return s;
    }
    if s.starts_with("http://") {
        // API Gateway suele requerir HTTPS; upgrade automático para evitar fallos por puerto 80.
        return format!("https://{}", s.trim_start_matches("http://"));
    }
    // Si el usuario pegó solo el host (sin esquema), asumimos HTTPS.
    format!("https://{}", s)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcceptInviteProvisionResponseDto {
    pub access_token: String,
    pub api_url: String,
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
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudMembershipsResponseDto {
    pub host_memberships: Vec<CloudMembershipDto>,
    pub member_memberships: Vec<CloudMembershipDto>,
}

fn load_host_api_auth() -> Result<(String, String, String), String> {
    let settings = config::load_settings();
    let base_url_raw = settings
        .api_base_url
        .as_deref()
        .ok_or("Configuración de API ausente")?
        .trim_end_matches('/');
    let base_url = normalize_base_url(base_url_raw);
    let api_key = settings
        .api_key
        .as_deref()
        .ok_or("API Key no encontrada en el almacenamiento seguro")?
        .to_string();
    let user_id = settings
        .user_id
        .as_deref()
        .ok_or("Usuario no configurado")?
        .to_string();
    Ok((base_url, api_key, user_id))
}

fn load_member_api_auth(host_user_id: &str) -> Result<(String, String, String), String> {
    let host = host_user_id.trim();
    if host.is_empty() {
        return Err("Host inválido".into());
    }

    let settings = config::load_settings();

    let base_url_raw = settings
        .cloud_host_api_base_urls
        .get(host)
        .ok_or("No existe conexión guardada para este host")?;
    let base_url = normalize_base_url(base_url_raw);

    let api_key = config::get_secure_api_key_for_cloud_host(host)
        .ok_or("Faltan credenciales de acceso para este host")?;

    let user_id = settings
        .user_id
        .as_deref()
        .ok_or("Usuario no configurado")?
        .trim()
        .to_string();

    Ok((base_url, api_key, user_id))
}

fn load_active_member_api_auth() -> Result<(String, String, String), String> {
    let settings = config::load_settings();
    if let Some(active_host) = settings
        .active_cloud_host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        return load_member_api_auth(active_host);
    }
    load_host_api_auth()
}

#[command]
pub async fn create_cloud_invite(
    invitee_user_id: Option<String>,
    with_token: Option<bool>,
    expires_in_days: Option<u32>,
) -> Result<CloudInviteDto, String> {
    let (base_url, api_key, user_id) = load_host_api_auth()?;
    let endpoint = format!("{}/invites", base_url);
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
    let response = API_CLIENT
        .post(&endpoint)
        .header("x-api-key", api_key)
        .header("x-user-id", user_id)
        .json(&serde_json::Value::Object(payload))
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "API Error ({}): {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }
    response
        .json::<CloudInviteDto>()
        .await
        .map_err(|e| format!("Error de deserialización: {}", e))
}

#[command]
pub async fn list_pending_cloud_invites() -> Result<Vec<CloudInviteDto>, String> {
    let (base_url, api_key, user_id) = load_active_member_api_auth()?;
    let endpoint = format!("{}/invites/pending", base_url);
    let response = API_CLIENT
        .get(&endpoint)
        .header("x-api-key", api_key)
        .header("x-user-id", user_id)
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;
    if !response.status().is_success() {
        return Err(format!(
            "API Error ({}): {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }
    let parsed = response
        .json::<PendingInvitesResponseDto>()
        .await
        .map_err(|e| format!("Error de deserialización: {}", e))?;
    Ok(parsed.items)
}

#[command]
pub async fn respond_cloud_invite(invite_id: String, action: String) -> Result<(), String> {
    let (base_url, api_key, user_id) = load_active_member_api_auth()?;
    let endpoint = format!("{}/invites/{}/respond", base_url, invite_id.trim());
    let payload = serde_json::json!({ "action": action.trim() });
    let response = API_CLIENT
        .post(&endpoint)
        .header("x-api-key", api_key)
        .header("x-user-id", user_id)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;
    if response.status().is_success() || response.status().as_u16() == 204 {
        return Ok(());
    }
    Err(format!(
        "API Error ({}): {}",
        response.status(),
        response.text().await.unwrap_or_default()
    ))
}

#[command]
pub async fn accept_cloud_invite_by_token(token: String) -> Result<(), String> {
    let (base_url, api_key, user_id) = load_active_member_api_auth()?;
    let endpoint = format!("{}/invites/accept-token", base_url);
    let payload = serde_json::json!({ "token": token.trim() });
    let response = API_CLIENT
        .post(&endpoint)
        .header("x-api-key", api_key)
        .header("x-user-id", user_id)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;
    if response.status().is_success() || response.status().as_u16() == 204 {
        return Ok(());
    }
    Err(format!(
        "API Error ({}): {}",
        response.status(),
        response.text().await.unwrap_or_default()
    ))
}

#[command]
pub async fn accept_cloud_invite_by_url(invite_url: String) -> Result<(), String> {
    let settings = config::load_settings();
    let user_id = settings
        .user_id
        .as_deref()
        .ok_or("Usuario no configurado")?
        .trim()
        .to_string();

    let trimmed = invite_url.trim().to_string();
    if trimmed.is_empty() {
        return Err("URL vacía".into());
    }

    // Espera algo como: https://host.tld/invites/accept/<token>
    let marker = "/invites/accept/";
    let idx = trimmed
        .find(marker)
        .ok_or("URL inválida: falta /invites/accept/<token>")?;
    let base_url = normalize_base_url(&trimmed[..idx]);
    let token = trimmed[idx + marker.len()..].trim().to_string();
    if token.is_empty() {
        return Err("URL inválida: token vacío".into());
    }

    let endpoint = format!("{}/invites/accept-token", base_url);
    let payload = serde_json::json!({ "token": token });

    // Bootstrap: esta llamada NO requiere x-api-key (ruta pública en backend).
    let response = API_CLIENT
        .post(&endpoint)
        .header("x-user-id", user_id.clone())
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "API Error ({}): {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    let parsed = response
        .json::<AcceptInviteProvisionResponseDto>()
        .await
        .map_err(|e| format!("Error de deserialización: {}", e))?;

    // Guardar provisionado por host:
    // - apiBaseUrl del host invitador
    // - accessToken en Keyring para ese host
    // - activar ese host para que Sync apunte a la conexión correcta
    let mut next = config::load_settings();
    next.cloud_host_api_base_urls.insert(
        parsed.host_user_id.clone(),
        parsed.api_url.trim_end_matches('/').to_string(),
    );
    next.active_cloud_host_user_id = Some(parsed.host_user_id);
    config::set_secure_api_key_for_cloud_host(
        next.active_cloud_host_user_id
            .as_deref()
            .unwrap_or_default(),
        // access_token
        parsed.access_token.as_str(),
    )?;
    config::save_settings(&next)?;

    Ok(())
}

#[command]
pub async fn leave_cloud_membership(host_user_id: String) -> Result<(), String> {
    let (base_url, api_key, user_id) = load_member_api_auth(&host_user_id)?;
    let endpoint = format!("{}/invites/memberships/leave", base_url);
    let payload = serde_json::json!({
      "hostUserId": host_user_id.trim(),
      "memberUserId": user_id,
    });
    let response = API_CLIENT
        .post(&endpoint)
        .header("x-api-key", api_key)
        .header(
            "x-user-id",
            payload
                .get("memberUserId")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
        )
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;
    if response.status().is_success() || response.status().as_u16() == 204 {
        return Ok(());
    }
    Err(format!(
        "API Error ({}): {}",
        response.status(),
        response.text().await.unwrap_or_default()
    ))
}

#[command]
pub async fn remove_cloud_member(member_user_id: String) -> Result<(), String> {
    let (base_url, api_key, user_id) = load_host_api_auth()?;
    let endpoint = format!("{}/invites/memberships/remove", base_url);
    let payload = serde_json::json!({
      "hostUserId": user_id,
      "memberUserId": member_user_id.trim(),
    });
    let response = API_CLIENT
        .post(&endpoint)
        .header("x-api-key", api_key)
        .header(
            "x-user-id",
            payload
                .get("hostUserId")
                .and_then(|v| v.as_str())
                .unwrap_or_default(),
        )
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Fallo de red: {}", e))?;
    if response.status().is_success() || response.status().as_u16() == 204 {
        return Ok(());
    }
    Err(format!(
        "API Error ({}): {}",
        response.status(),
        response.text().await.unwrap_or_default()
    ))
}

#[command]
pub async fn list_cloud_memberships() -> Result<CloudMembershipsResponseDto, String> {
    let settings = config::load_settings();
    let user_id = settings
        .user_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .ok_or("Usuario no configurado")?
        .to_string();

    let mut host_memberships: Vec<CloudMembershipDto> = vec![];
    let mut member_memberships: Vec<CloudMembershipDto> = vec![];

    // 1) Tu propia nube: solo nos interesa host_memberships.
    if let (Some(base_url_raw), Some(api_key_raw)) = (
        settings.api_base_url.as_deref(),
        settings.api_key.as_deref(),
    ) {
        if !base_url_raw.trim().is_empty() && !api_key_raw.trim().is_empty() {
            let base_url = normalize_base_url(base_url_raw);
            let endpoint = format!("{}/invites/memberships", base_url);
            let response = API_CLIENT
                .get(&endpoint)
                .header("x-api-key", api_key_raw)
                .header("x-user-id", &user_id)
                .send()
                .await
                .map_err(|e| format!("Fallo de red: {}", e))?;

            if response.status().is_success() {
                let parsed = response
                    .json::<CloudMembershipsResponseDto>()
                    .await
                    .map_err(|e| format!("Error de deserialización: {}", e))?;
                host_memberships = parsed.host_memberships;
            }
        }
    }

    // 2) Nubes de hosts donde eres miembro: solo nos interesan member_memberships.
    for (host, _base_url) in settings.cloud_host_api_base_urls.iter() {
        let (base_url, api_key, _) = match load_member_api_auth(host) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let endpoint = format!("{}/invites/memberships", base_url);
        let response = API_CLIENT
            .get(&endpoint)
            .header("x-api-key", api_key)
            .header("x-user-id", &user_id)
            .send()
            .await
            .map_err(|e| format!("Fallo de red: {}", e))?;

        if response.status().is_success() {
            let parsed = response
                .json::<CloudMembershipsResponseDto>()
                .await
                .map_err(|e| format!("Error de deserialización: {}", e))?;
            member_memberships.extend(parsed.member_memberships);
        }
    }

    Ok(CloudMembershipsResponseDto {
        host_memberships,
        member_memberships,
    })
}
