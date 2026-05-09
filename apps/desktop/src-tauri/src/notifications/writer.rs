//! Registro de notificaciones desde eventos de sync, auto-sync, torrent y fuentes.

use chrono::Utc;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

use crate::config;
use crate::sources::domain::{DownloadProtocol, SourceDownloadJob, SourceJobStatus};
use crate::sqlite::AppDb;

use super::db::{self, get_or_create_device_id};
use super::models::{compute_dedup_key, NotificationRecordDto};

/// Evento emitido al insertar o fusionar notificaciones locales para refrescar badge/lista en el frontend.
pub const NOTIFICATIONS_CHANGED_EVENT: &str = "notifications-changed";

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn sync_ver() -> i64 {
    Utc::now().timestamp_millis()
}

/// Última vez que se emitió el evento de cambio (en ms) para throttling.
static LAST_EMISSION_MS: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

pub fn emit_notifications_changed(app: &AppHandle) {
    let now = Utc::now().timestamp_millis();
    let last = LAST_EMISSION_MS.load(std::sync::atomic::Ordering::Relaxed);

    // Evitar ráfagas de refresco en el frontend durante operaciones batch (ej. sync upload all).
    // Si emitimos hace menos de 1.5 segundos, ignoramos la nueva petición de emisión.
    if now - last < 1500 {
        return;
    }

    LAST_EMISSION_MS.store(now, std::sync::atomic::Ordering::Relaxed);
    let _ = app.emit(NOTIFICATIONS_CHANGED_EVENT, serde_json::Value::Null);
}

/// True si el torrent lo gestiona un job de instalación por fuentes (misma descarga): evita duplicar con `torrent_done`.
fn torrent_covered_by_sources_install(app: &AppHandle, info_hash: &str) -> bool {
    let Some(sources) = app.try_state::<crate::sources::queue::SourcesState>() else {
        return false;
    };
    let now = Utc::now();
    for j in sources.list_jobs() {
        if j.external_id.as_deref() != Some(info_hash) {
            continue;
        }
        if !matches!(
            j.status,
            SourceJobStatus::Running | SourceJobStatus::Completed
        ) {
            continue;
        }
        if let Ok(t) = chrono::DateTime::parse_from_rfc3339(&j.updated_at) {
            let age = now.signed_duration_since(t.with_timezone(&chrono::Utc));
            if age.num_seconds() >= 0 && age.num_seconds() <= 300 {
                return true;
            }
        }
    }
    false
}

fn protocol_label(p: &DownloadProtocol) -> &'static str {
    match p {
        DownloadProtocol::Http => "HTTP",
        DownloadProtocol::TorrentMagnet => "Magnet",
        DownloadProtocol::TorrentFile => "Torrent",
        DownloadProtocol::Unknown => "Desconocido",
    }
}

/// Registra fin de job de instalación desde catálogo/fuentes (HTTP o torrent).
pub fn try_record_source_download_terminal(app: &AppHandle, job: &SourceDownloadJob) {
    let Some(db) = app.try_state::<AppDb>() else {
        return;
    };
    let cfg = config::load_config();
    let Some(user_id) = cfg.user_id.filter(|s| !s.trim().is_empty()) else {
        return;
    };

    let status_str = match job.status {
        SourceJobStatus::Completed => "completed",
        SourceJobStatus::Failed => "failed",
        SourceJobStatus::Cancelled => "cancelled",
        _ => return,
    };

    let kind = "source_download_terminal";
    let dedup = compute_dedup_key(kind, Some(job.job_id.as_str()), Some(status_str), None);

    let proto = protocol_label(&job.protocol);
    let dest_short = if job.destination_dir.len() > 120 {
        format!(
            "{}…",
            &job.destination_dir.chars().take(120).collect::<String>()
        )
    } else {
        job.destination_dir.clone()
    };

    let (severity, title, body) = match job.status {
        SourceJobStatus::Completed => (
            "success",
            format!("Descarga completada: {}", job.title),
            format!("{proto} · guardado en {dest_short}"),
        ),
        SourceJobStatus::Failed => (
            "error",
            format!("Error al descargar: {}", job.title),
            job.error
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or("La descarga falló.").to_string(),
        ),
        SourceJobStatus::Cancelled => (
            "warning",
            format!("Descarga cancelada: {}", job.title),
            format!("{proto} · la instalación se detuvo."),
        ),
        _ => return,
    };

    let payload = serde_json::json!({
        "jobId": job.job_id,
        "protocol": job.protocol,
        "status": status_str,
        "destinationDir": job.destination_dir,
    });

    let device_id = get_or_create_device_id(&db).unwrap_or_else(|_| String::new());

    let mut rec = NotificationRecordDto {
        id: Uuid::new_v4().to_string(),
        user_id,
        kind: kind.to_string(),
        severity: severity.to_string(),
        title,
        body,
        game_id: None,
        operation_id: Some(job.job_id.clone()),
        status: Some(status_str.to_string()),
        reason_code: None,
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

    let inserted = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(false);
        }
        db::insert_notification(conn, &mut rec)?;
        Ok(true)
    });
    if let Ok(true) = inserted {
        emit_notifications_changed(app);
    }
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
    let dedup = compute_dedup_key(kind, Some(operation_id), Some(status), game_id.as_deref());

    let device_id = get_or_create_device_id(&db).unwrap_or_else(|_| String::new());
    let gid = game_id.clone().unwrap_or_default();
    let game_label = if gid.is_empty() {
        "Juego".to_string()
    } else {
        gid.clone()
    };

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
                reason_code
                    .clone()
                    .unwrap_or_else(|| "Ver detalles en el registro.".to_string())
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

    let inserted = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(false);
        }
        db::insert_notification(conn, &mut rec)?;
        Ok(true)
    });
    if let Ok(true) = inserted {
        emit_notifications_changed(app);
    }
}

pub fn try_record_auto_sync_done(app: &AppHandle, game_id: &str, ok_count: u32, err_count: u32) {
    let Some(db) = app.try_state::<AppDb>() else {
        return;
    };
    let cfg = config::load_config();
    let Some(user_id) = cfg.user_id.filter(|s| !s.trim().is_empty()) else {
        return;
    };

    let status = if err_count == 0 {
        "completed"
    } else {
        "failed"
    };
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

    let inserted = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(false);
        }
        db::insert_notification(conn, &mut rec)?;
        Ok(true)
    });
    if let Ok(true) = inserted {
        emit_notifications_changed(app);
    }
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

    let inserted = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(false);
        }
        db::insert_notification(conn, &mut rec)?;
        Ok(true)
    });
    if let Ok(true) = inserted {
        emit_notifications_changed(app);
    }
}

pub fn try_record_torrent_done(app: &AppHandle, name: &str, info_hash: &str) {
    if torrent_covered_by_sources_install(app, info_hash) {
        return;
    }

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
        body: name.to_string(),
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

    let inserted = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(false);
        }
        db::insert_notification(conn, &mut rec)?;
        Ok(true)
    });
    if let Ok(true) = inserted {
        emit_notifications_changed(app);
    }
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
        body: name.to_string(),
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

    let inserted = db.with_conn(|conn| {
        if db::recent_duplicate_exists(conn, &rec.user_id, &dedup)? {
            return Ok(false);
        }
        db::insert_notification(conn, &mut rec)?;
        Ok(true)
    });
    if let Ok(true) = inserted {
        emit_notifications_changed(app);
    }
}
