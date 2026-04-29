//! Construye `DesktopHealthSnapshot` para IPC.

use serde::Serialize;
use tauri::State;

use crate::cloud::ws_manager::CloudWsState;
use crate::commands::logs::sync_logger;
use crate::config;
use crate::config::AppSettings;
use crate::notifications::db;
use crate::sqlite::AppDb;

use super::metrics::{recent_errors_window, summarize_http_window, ErrorEntry, SavesApiSummary};

const WINDOW_15M_MS: i64 = 15 * 60 * 1000;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WsHealthBlock {
    pub connected: bool,
    pub pending_queue_len: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_connected_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_disconnected_at_ms: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error_at_ms: Option<i64>,
    pub total_successful_connections: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudConfigBlock {
    pub configured: bool,
    pub has_api_base_url: bool,
    pub has_ws_url: bool,
    pub has_user_id: bool,
    pub has_api_credentials: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_base_host_preview: Option<String>,
    pub is_guest_cloud: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationsHealthBlock {
    pub unread_count: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestedAction {
    pub id: String,
    pub title: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_kind: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopHealthSnapshot {
    pub generated_at_ms: i64,
    pub cloud: CloudConfigBlock,
    pub ws: WsHealthBlock,
    pub sync_api: SavesApiSummary,
    pub recent_errors: Vec<ErrorEntry>,
    pub notifications: NotificationsHealthBlock,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub debug_log_path: Option<String>,
    pub suggested_actions: Vec<SuggestedAction>,
}

fn guest_host_id(settings: &AppSettings) -> Option<&str> {
    settings
        .active_cloud_host_user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn build_cloud_block(settings: &AppSettings) -> CloudConfigBlock {
    let has_api_base_url = settings
        .api_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();

    let guest_api_ok = guest_host_id(settings)
        .and_then(|h| settings.cloud_host_api_base_urls.get(h))
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let has_own_api = has_api_base_url || guest_api_ok;

    let has_ws_url = settings
        .ws_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();

    let guest_ws_ok = guest_host_id(settings)
        .and_then(|h| settings.cloud_host_ws_base_urls.get(h))
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    let has_ws_effective = has_ws_url || guest_ws_ok;

    let has_user_id = settings
        .user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();

    let has_api_key = settings
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .is_some();

    let is_guest = guest_host_id(settings).is_some();

    let api_preview = settings
        .api_base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|u| url::Url::parse(u).ok())
        .map(|u| u.host_str().unwrap_or("").to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            guest_host_id(settings).and_then(|h| {
                settings
                    .cloud_host_api_base_urls
                    .get(h)
                    .and_then(|u| url::Url::parse(u.trim()).ok())
                    .map(|p| p.host_str().unwrap_or("").to_string())
                    .filter(|s| !s.is_empty())
            })
        });

    let configured = has_user_id && has_ws_effective && has_own_api && (has_api_key || is_guest);

    CloudConfigBlock {
        configured,
        has_api_base_url: has_own_api,
        has_ws_url: has_ws_effective,
        has_user_id,
        has_api_credentials: has_api_key,
        api_base_host_preview: api_preview,
        is_guest_cloud: is_guest,
    }
}

fn offline_seconds(ws: &WsHealthBlock) -> i64 {
    if ws.connected {
        return 0;
    }
    let now = chrono::Utc::now().timestamp_millis();
    match ws.last_disconnected_at_ms {
        Some(t) => (now - t).max(0) / 1000,
        None => 0,
    }
}

fn build_suggestions(
    cloud: &CloudConfigBlock,
    ws: &WsHealthBlock,
    sync: &SavesApiSummary,
    recent: &[ErrorEntry],
) -> Vec<SuggestedAction> {
    let mut out: Vec<SuggestedAction> = Vec::new();

    if !cloud.configured {
        out.push(SuggestedAction {
            id: "finish_cloud_setup".into(),
            title: "Completar configuración de nube".into(),
            description: "Define API base, WebSocket, usuario y credenciales en Configuración."
                .into(),
            action_kind: Some("open_settings".into()),
        });
    }

    let off = offline_seconds(ws);
    if cloud.configured && !ws.connected && off > 60 {
        out.push(SuggestedAction {
            id: "restart_cloud_ws".into(),
            title: "Reiniciar conexión en tiempo real".into(),
            description: format!(
                "El WebSocket lleva ~{} s sin estar conectado. Prueba reiniciar la conexión.",
                off
            ),
            action_kind: Some("restart_ws".into()),
        });
    }

    let err_rate = if sync.sample_count > 0 {
        sync.error_count as f64 / sync.sample_count as f64
    } else {
        0.0
    };
    if sync.sample_count >= 5 && err_rate > 0.2 {
        out.push(SuggestedAction {
            id: "review_sync_errors".into(),
            title: "Revisar errores de sincronización".into(),
            description: format!(
                "Tasa de error HTTP reciente ~{:.0} % en llamadas a la API de saves.",
                err_rate * 100.0
            ),
            action_kind: Some("open_history".into()),
        });
    }

    if let Some(p95) = sync.p95_ms {
        if p95 > 2500 && sync.sample_count >= 3 {
            out.push(SuggestedAction {
                id: "high_latency".into(),
                title: "Latencia alta hacia la API".into(),
                description: format!(
                    "P95 ~{} ms en los últimos 15 min. Comprueba red o carga del servidor.",
                    p95
                ),
                action_kind: None,
            });
        }
    }

    let auth_hits = recent
        .iter()
        .filter(|e| {
            e.message.contains("401")
                || e.message.to_lowercase().contains("unauthorized")
                || e.status_code == Some(401)
        })
        .count();
    if auth_hits >= 2 {
        out.push(SuggestedAction {
            id: "check_credentials".into(),
            title: "Revisar credenciales".into(),
            description:
                "Varios errores parecen de autenticación (401). Verifica API key y usuario id."
                    .into(),
            action_kind: Some("open_settings".into()),
        });
    }

    out.push(SuggestedAction {
        id: "copy_debug".into(),
        title: "Copiar diagnóstico".into(),
        description: "Genera un JSON para soporte (sin secretos en campos sensibles).".into(),
        action_kind: Some("copy_diagnostic".into()),
    });

    out
}

/// Snapshot serializable hacia el frontend.
pub async fn build_snapshot(
    cloud: &CloudWsState,
    db: &AppDb,
) -> Result<DesktopHealthSnapshot, String> {
    let settings = config::load_settings();
    let cloud_block = build_cloud_block(&settings);

    let (m, pending_len) = cloud.observability_ws_snapshot().await;
    let ws_block = WsHealthBlock {
        connected: m.connected,
        pending_queue_len: pending_len,
        last_connected_at_ms: m.last_connected_at_ms,
        last_disconnected_at_ms: m.last_disconnected_at_ms,
        last_error: m.last_error,
        last_error_at_ms: m.last_error_at_ms,
        total_successful_connections: m.total_successful_connections,
    };

    let sync_api = summarize_http_window(WINDOW_15M_MS);
    let recent_errors = recent_errors_window(WINDOW_15M_MS, 12);

    let unread = if let Some(uid) = settings
        .user_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        db.with_conn(|conn| db::unread_count(conn, uid))
            .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?
    } else {
        0
    };

    let suggested_actions = build_suggestions(&cloud_block, &ws_block, &sync_api, &recent_errors);

    Ok(DesktopHealthSnapshot {
        generated_at_ms: chrono::Utc::now().timestamp_millis(),
        cloud: cloud_block,
        ws: ws_block,
        sync_api,
        recent_errors,
        notifications: NotificationsHealthBlock {
            unread_count: unread,
        },
        debug_log_path: sync_logger::log_file_path(),
        suggested_actions,
    })
}

#[tauri::command]
pub async fn get_observability_snapshot(
    cloud_state: State<'_, CloudWsState>,
    db: State<'_, AppDb>,
) -> Result<DesktopHealthSnapshot, String> {
    build_snapshot(cloud_state.inner(), db.inner()).await
}
