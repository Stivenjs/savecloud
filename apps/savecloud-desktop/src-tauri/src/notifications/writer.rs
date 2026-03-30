//! Registro de notificaciones desde eventos de sync, auto-sync y torrent.

use chrono::Utc;
use tauri::{AppHandle, Manager};
use uuid::Uuid;

use crate::config;
use crate::sqlite::AppDb;

use super::db::{self, get_or_create_device_id};
use super::models::{compute_dedup_key, NotificationRecordDto};

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn sync_ver() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn try_record_sync_terminal(
    app: &AppHandle,
    operation_id: &str,
    status: &str,
    ty: &str,
    game_id: Option<String>,
    reason_code: Option<String>,
) {
    let Some(db) = app.try_state::<AppDb>() else {
        return;
    };
    let cfg = config::load_config();
    let Some(user_id) = cfg.user_id.filter(|s| !s.trim().is_empty()) else {
        return;
    };

    let kind = "sync_terminal";
    let dedup = compute_dedup_key(
        kind,
        Some(operation_id),
        Some(status),
        game_id.as_deref(),
    );

    let device_id = get_or_create_device_id(&db).unwrap_or_else(|_| String::new());
    let gid = game_id.clone().unwrap_or_default();
    let game_label = if gid.is_empty() { "Juego".to_string() } else { gid.clone() };

    let (severity, title, body) = match status {
        "completed" => (
            "success",
            format!("Sincronización completada ({ty})"),
            format!("Operación terminada correctamente para {game_label}."),
        ),
        "cancelled" => (
            "warning",
            format!("Sincronización cancelada ({ty})"),
            format!("La operación se canceló para {game_label}."),
        ),
        "paused" => (
            "info",
            format!("Sincronización en pausa ({ty})"),
            format!("Pausado: {game_label}."),
        ),
        _ => (
            "error",
            format!("Sincronización fallida ({ty})"),
            format!(
                "Error en {game_label}. {}",
                reason_code.clone().unwrap_or_else(|| "Ver detalles en el registro.".to_string())
            ),
        ),
    };

    let payload = serde_json::json!({
        "type": ty,
        "status": status,
        "operationId": operation_id,
        "reasonCode": reason_code,
    });

    let mut rec = NotificationRecordDto {
        id: Uuid::new_v4().to_string(),
        user_id,
        kind: kind.to_string(),
        severity: severity.to_string(),
        title,
        body,
        game_id,
        operation_id: Some(operation_id.to_string()),
        status: Some(status.to_string()),
        reason_code,
        payload_json: Some(payload.to_string()),
        dedup_key: Some(dedup.clone()),
        created_at: now_rfc3339(),
        updated_at: now_rfc3339(),
        read_at: None,
        dismissed_at: None,
        source_device_id: Some(device_id),
        server_updated_at: None,
        pending_sync: true,
        sync_version: sync_ver(),
    };

    let _ = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(());
        }
        db::insert_notification(conn, &mut rec)
    });
}

pub fn try_record_auto_sync_done(app: &AppHandle, game_id: &str, ok_count: u32, err_count: u32) {
    let Some(db) = app.try_state::<AppDb>() else {
        return;
    };
    let cfg = config::load_config();
    let Some(user_id) = cfg.user_id.filter(|s| !s.trim().is_empty()) else {
        return;
    };

    let status = if err_count == 0 { "completed" } else { "failed" };
    let kind = "auto_sync_done";
    let dedup = compute_dedup_key(kind, None, Some(status), Some(game_id));

    let device_id = get_or_create_device_id(&db).unwrap_or_else(|_| String::new());
    let (severity, title, body) = if err_count == 0 {
        (
            "success",
            "Auto-sync completado".to_string(),
            format!("Subida automática: {ok_count} archivo(s) correctos para {game_id}."),
        )
    } else {
        (
            "warning",
            "Auto-sync con errores".to_string(),
            format!("Juego {game_id}: {ok_count} ok, {err_count} error(es)."),
        )
    };

    let mut rec = NotificationRecordDto {
        id: Uuid::new_v4().to_string(),
        user_id,
        kind: kind.to_string(),
        severity: severity.to_string(),
        title,
        body,
        game_id: Some(game_id.to_string()),
        operation_id: None,
        status: Some(status.to_string()),
        reason_code: None,
        payload_json: Some(
            serde_json::json!({ "okCount": ok_count, "errCount": err_count }).to_string(),
        ),
        dedup_key: Some(dedup.clone()),
        created_at: now_rfc3339(),
        updated_at: now_rfc3339(),
        read_at: None,
        dismissed_at: None,
        source_device_id: Some(device_id),
        server_updated_at: None,
        pending_sync: true,
        sync_version: sync_ver(),
    };

    let _ = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(());
        }
        db::insert_notification(conn, &mut rec)
    });
}

pub fn try_record_auto_sync_error(app: &AppHandle, game_id: &str, error: &str) {
    let Some(db) = app.try_state::<AppDb>() else {
        return;
    };
    let cfg = config::load_config();
    let Some(user_id) = cfg.user_id.filter(|s| !s.trim().is_empty()) else {
        return;
    };

    let kind = "auto_sync_error";
    let dedup = compute_dedup_key(kind, None, Some("failed"), Some(game_id));
    let device_id = get_or_create_device_id(&db).unwrap_or_else(|_| String::new());

    let mut rec = NotificationRecordDto {
        id: Uuid::new_v4().to_string(),
        user_id,
        kind: kind.to_string(),
        severity: "error".to_string(),
        title: "Error en auto-sync".to_string(),
        body: format!("{game_id}: {error}"),
        game_id: Some(game_id.to_string()),
        operation_id: None,
        status: Some("failed".to_string()),
        reason_code: Some("AUTO_SYNC_ERROR".to_string()),
        payload_json: Some(serde_json::json!({ "error": error }).to_string()),
        dedup_key: Some(dedup.clone()),
        created_at: now_rfc3339(),
        updated_at: now_rfc3339(),
        read_at: None,
        dismissed_at: None,
        source_device_id: Some(device_id),
        server_updated_at: None,
        pending_sync: true,
        sync_version: sync_ver(),
    };

    let _ = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(());
        }
        db::insert_notification(conn, &mut rec)
    });
}

pub fn try_record_torrent_done(app: &AppHandle, name: &str, info_hash: &str) {
    let Some(db) = app.try_state::<AppDb>() else {
        return;
    };
    let cfg = config::load_config();
    let Some(user_id) = cfg.user_id.filter(|s| !s.trim().is_empty()) else {
        return;
    };

    let kind = "torrent_done";
    let dedup = compute_dedup_key(kind, Some(info_hash), Some("completed"), None);
    let device_id = get_or_create_device_id(&db).unwrap_or_else(|_| String::new());

    let mut rec = NotificationRecordDto {
        id: Uuid::new_v4().to_string(),
        user_id,
        kind: kind.to_string(),
        severity: "success".to_string(),
        title: "Descarga torrent completada".to_string(),
        body: format!("{name}"),
        game_id: None,
        operation_id: Some(info_hash.to_string()),
        status: Some("completed".to_string()),
        reason_code: None,
        payload_json: Some(serde_json::json!({ "infoHash": info_hash }).to_string()),
        dedup_key: Some(dedup.clone()),
        created_at: now_rfc3339(),
        updated_at: now_rfc3339(),
        read_at: None,
        dismissed_at: None,
        source_device_id: Some(device_id),
        server_updated_at: None,
        pending_sync: true,
        sync_version: sync_ver(),
    };

    let _ = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(());
        }
        db::insert_notification(conn, &mut rec)
    });
}

pub fn try_record_torrent_cancelled(app: &AppHandle, name: &str, info_hash: &str) {
    let Some(db) = app.try_state::<AppDb>() else {
        return;
    };
    let cfg = config::load_config();
    let Some(user_id) = cfg.user_id.filter(|s| !s.trim().is_empty()) else {
        return;
    };

    let kind = "torrent_cancelled";
    let dedup = compute_dedup_key(kind, Some(info_hash), Some("cancelled"), None);
    let device_id = get_or_create_device_id(&db).unwrap_or_else(|_| String::new());

    let mut rec = NotificationRecordDto {
        id: Uuid::new_v4().to_string(),
        user_id,
        kind: kind.to_string(),
        severity: "warning".to_string(),
        title: "Descarga torrent cancelada".to_string(),
        body: format!("{name}"),
        game_id: None,
        operation_id: Some(info_hash.to_string()),
        status: Some("cancelled".to_string()),
        reason_code: None,
        payload_json: Some(serde_json::json!({ "infoHash": info_hash }).to_string()),
        dedup_key: Some(dedup.clone()),
        created_at: now_rfc3339(),
        updated_at: now_rfc3339(),
        read_at: None,
        dismissed_at: None,
        source_device_id: Some(device_id),
        server_updated_at: None,
        pending_sync: true,
        sync_version: sync_ver(),
    };

    let _ = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(());
        }
        db::insert_notification(conn, &mut rec)
    });
}
