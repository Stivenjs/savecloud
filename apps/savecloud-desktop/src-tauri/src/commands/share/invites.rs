use crate::config;
use crate::network::API_CLIENT;
use serde::{Deserialize, Serialize};
use tauri::command;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudInviteDto {
    pub id: String,
    pub host_user_id: String,
    pub invitee_user_id: Option<String>,
    pub token: Option<String>,
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

fn load_api_auth() -> Result<(String, String, String), String> {
    let settings = config::load_settings();
    let base_url = settings
        .api_base_url
        .as_deref()
        .ok_or("Configuración de API ausente")?
        .trim_end_matches('/')
        .to_string();
    let api_key = settings
        .api_key
        .as_deref()
        .ok_or("API Key no encontrada en el almacenamiento seguro")?
        .to_string();
    let user_id = settings
        .user_id
        .as_deref()
        .ok_or("User ID no configurado")?
        .to_string();
    Ok((base_url, api_key, user_id))
}

#[command]
pub async fn create_cloud_invite(
    invitee_user_id: Option<String>,
    with_token: Option<bool>,
    expires_in_days: Option<u32>,
) -> Result<CloudInviteDto, String> {
    let (base_url, api_key, user_id) = load_api_auth()?;
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
    let (base_url, api_key, user_id) = load_api_auth()?;
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
    let (base_url, api_key, user_id) = load_api_auth()?;
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
    let (base_url, api_key, user_id) = load_api_auth()?;
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
pub async fn leave_cloud_membership(host_user_id: String) -> Result<(), String> {
    let (base_url, api_key, user_id) = load_api_auth()?;
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
    let (base_url, api_key, user_id) = load_api_auth()?;
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
    let (base_url, api_key, user_id) = load_api_auth()?;
    let endpoint = format!("{}/invites/memberships", base_url);
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
    response
        .json::<CloudMembershipsResponseDto>()
        .await
        .map_err(|e| format!("Error de deserialización: {}", e))
}
