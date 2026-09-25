//! Acceso SQLite a `notification_events`.

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::sqlite::AppDb;

use super::models::NotificationRecordDto;

const DEDUP_WINDOW_SECS: i64 = 10;

pub fn get_or_create_device_id(db: &AppDb) -> Result<String, crate::sqlite::error::SqliteError> {
    let user_id = crate::config::load_config().user_id.unwrap_or_default();
    let user_key = if user_id.trim().is_empty() {
        "device_id".to_string()
    } else {
        format!("{user_id}:device_id")
    };
    let existing: Option<String> = db.with_conn(|conn| {
        conn.query_row(
            "SELECT value FROM notification_meta WHERE key = ?1 OR key = 'device_id'",
            [&user_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
    })?;

    if let Some(id) = existing.filter(|s| !s.is_empty()) {
        return Ok(id);
    }

    let id = uuid::Uuid::new_v4().to_string();
    db.with_conn(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO notification_meta (key, value) VALUES (?1, ?2)",
            params![&user_key, &id],
        )?;
        Ok(())
    })?;
    Ok(id)
}

pub fn get_meta(
    db: &AppDb,
    key: &str,
) -> Result<Option<String>, crate::sqlite::error::SqliteError> {
    db.with_conn(|conn| {
        conn.query_row(
            "SELECT value FROM notification_meta WHERE key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()
    })
}

pub fn set_meta(
    db: &AppDb,
    key: &str,
    value: &str,
) -> Result<(), crate::sqlite::error::SqliteError> {
    db.with_conn(|conn| {
        conn.execute(
            "INSERT OR REPLACE INTO notification_meta (key, value) VALUES (?1, ?2)",
            params![key, value],
        )?;
        Ok(())
    })
}

fn row_to_dto(row: &rusqlite::Row<'_>) -> rusqlite::Result<NotificationRecordDto> {
    Ok(NotificationRecordDto {
        id: row.get(0)?,
        user_id: row.get(1)?,
        kind: row.get(2)?,
        severity: row.get(3)?,
        title: row.get(4)?,
        body: row.get(5)?,
        game_id: row.get(6)?,
        operation_id: row.get(7)?,
        status: row.get(8)?,
        reason_code: row.get(9)?,
        payload_json: row.get(10)?,
        dedup_key: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        read_at: row.get(14)?,
        dismissed_at: row.get(15)?,
        source_device_id: row.get(16)?,
        server_updated_at: row.get(17)?,
        pending_sync: row.get::<_, i64>(18)? != 0,
        sync_version: row.get(19)?,
    })
}

pub fn list_notifications(
    conn: &Connection,
    user_id: &str,
    limit: i64,
    offset: i64,
    unread_only: bool,
) -> Result<Vec<NotificationRecordDto>, rusqlite::Error> {
    let sql = if unread_only {
        "SELECT id, user_id, kind, severity, title, body, game_id, operation_id, status, reason_code, payload_json, dedup_key, created_at, updated_at, read_at, dismissed_at, source_device_id, server_updated_at, pending_sync, sync_version
         FROM notification_events
         WHERE user_id = ?1
           AND (read_at IS NULL OR trim(read_at) = '')
           AND (dismissed_at IS NULL OR trim(dismissed_at) = '')
         ORDER BY datetime(created_at) DESC
         LIMIT ?2 OFFSET ?3"
    } else {
        "SELECT id, user_id, kind, severity, title, body, game_id, operation_id, status, reason_code, payload_json, dedup_key, created_at, updated_at, read_at, dismissed_at, source_device_id, server_updated_at, pending_sync, sync_version
         FROM notification_events
         WHERE user_id = ?1 AND (dismissed_at IS NULL OR trim(dismissed_at) = '')
         ORDER BY datetime(created_at) DESC
         LIMIT ?2 OFFSET ?3"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![user_id, limit, offset], row_to_dto)?;
    rows.collect()
}

pub fn insert_notification(
    conn: &Connection,
    rec: &mut NotificationRecordDto,
) -> Result<(), rusqlite::Error> {
    super::models::normalize_notification_record_for_storage(rec);
    conn.execute(
        "INSERT INTO notification_events (
            id, user_id, kind, severity, title, body, game_id, operation_id, status, reason_code, payload_json, dedup_key,
            created_at, updated_at, read_at, dismissed_at, source_device_id, server_updated_at, pending_sync, sync_version
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        params![
            rec.id,
            rec.user_id,
            rec.kind,
            rec.severity,
            rec.title,
            rec.body,
            rec.game_id,
            rec.operation_id,
            rec.status,
            rec.reason_code,
            rec.payload_json,
            rec.dedup_key,
            rec.created_at,
            rec.updated_at,
            rec.read_at,
            rec.dismissed_at,
            rec.source_device_id,
            rec.server_updated_at,
            if rec.pending_sync { 1i64 } else { 0i64 },
            rec.sync_version,
        ],
    )?;
    Ok(())
}

/// Evita duplicados recientes con el mismo `dedup_key`.
pub fn recent_duplicate_exists(
    conn: &Connection,
    user_id: &str,
    dedup_key: &str,
) -> Result<bool, rusqlite::Error> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(1) FROM notification_events
         WHERE user_id = ?1 AND dedup_key = ?2
           AND datetime(created_at) > datetime('now', ?3)",
        params![user_id, dedup_key, format!("-{DEDUP_WINDOW_SECS} seconds")],
        |row| row.get(0),
    )?;
    Ok(n > 0)
}

pub fn upsert_merged(
    conn: &Connection,
    rec: &mut NotificationRecordDto,
) -> Result<(), rusqlite::Error> {
    super::models::normalize_notification_record_for_storage(rec);
    conn.execute(
        "INSERT INTO notification_events (
            id, user_id, kind, severity, title, body, game_id, operation_id, status, reason_code, payload_json, dedup_key,
            created_at, updated_at, read_at, dismissed_at, source_device_id, server_updated_at, pending_sync, sync_version
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
        ON CONFLICT(id) DO UPDATE SET
            user_id = excluded.user_id,
            kind = excluded.kind,
            severity = excluded.severity,
            title = excluded.title,
            body = excluded.body,
            game_id = excluded.game_id,
            operation_id = excluded.operation_id,
            status = excluded.status,
            reason_code = excluded.reason_code,
            payload_json = excluded.payload_json,
            dedup_key = excluded.dedup_key,
            updated_at = excluded.updated_at,
            read_at = COALESCE(excluded.read_at, notification_events.read_at),
            dismissed_at = COALESCE(excluded.dismissed_at, notification_events.dismissed_at),
            source_device_id = excluded.source_device_id,
            server_updated_at = excluded.server_updated_at,
            pending_sync = excluded.pending_sync,
            sync_version = CASE WHEN excluded.sync_version > notification_events.sync_version
              THEN excluded.sync_version ELSE notification_events.sync_version END",
        params![
            rec.id,
            rec.user_id,
            rec.kind,
            rec.severity,
            rec.title,
            rec.body,
            rec.game_id,
            rec.operation_id,
            rec.status,
            rec.reason_code,
            rec.payload_json,
            rec.dedup_key,
            rec.created_at,
            rec.updated_at,
            rec.read_at,
            rec.dismissed_at,
            rec.source_device_id,
            rec.server_updated_at,
            if rec.pending_sync { 1i64 } else { 0i64 },
            rec.sync_version,
        ],
    )?;
    Ok(())
}

pub fn mark_read(conn: &Connection, user_id: &str, id: &str) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE notification_events
         SET read_at = ?1, updated_at = ?1, pending_sync = 1, sync_version = sync_version + 1
         WHERE id = ?2
           AND user_id = ?3
           AND (read_at IS NULL OR trim(read_at) = '')
           AND (dismissed_at IS NULL OR trim(dismissed_at) = '')",
        params![now, id, user_id],
    )?;
    Ok(())
}

pub fn mark_all_read(conn: &Connection, user_id: &str) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE notification_events SET read_at = ?1, updated_at = ?1, pending_sync = 1, sync_version = sync_version + 1
         WHERE user_id = ?2
           AND (read_at IS NULL OR trim(read_at) = '')
           AND (dismissed_at IS NULL OR trim(dismissed_at) = '')",
        params![now, user_id],
    )?;
    Ok(())
}

pub fn dismiss(conn: &Connection, user_id: &str, id: &str) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE notification_events SET dismissed_at = ?1, updated_at = ?1, pending_sync = 1, sync_version = sync_version + 1
         WHERE id = ?2 AND user_id = ?3",
        params![now, id, user_id],
    )?;
    Ok(())
}

pub fn dismiss_all(conn: &Connection, user_id: &str) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE notification_events SET dismissed_at = ?1, updated_at = ?1, pending_sync = 1, sync_version = sync_version + 1
         WHERE user_id = ?2 AND (dismissed_at IS NULL OR trim(dismissed_at) = '')",
        params![now, user_id],
    )?;
    Ok(())
}

pub fn list_pending_sync(
    conn: &Connection,
    user_id: &str,
    limit: i64,
) -> Result<Vec<NotificationRecordDto>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, kind, severity, title, body, game_id, operation_id, status, reason_code, payload_json, dedup_key, created_at, updated_at, read_at, dismissed_at, source_device_id, server_updated_at, pending_sync, sync_version
         FROM notification_events
         WHERE user_id = ?1 AND pending_sync = 1
         ORDER BY datetime(updated_at) ASC
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![user_id, limit], row_to_dto)?;
    rows.collect()
}

pub fn clear_pending_sync(conn: &Connection, ids: &[String]) -> Result<(), rusqlite::Error> {
    if ids.is_empty() {
        return Ok(());
    }
    for id in ids {
        conn.execute(
            "UPDATE notification_events SET pending_sync = 0 WHERE id = ?1",
            [id],
        )?;
    }
    Ok(())
}

pub fn unread_count(conn: &Connection, user_id: &str) -> Result<i64, rusqlite::Error> {
    conn.query_row(
        "SELECT COUNT(1) FROM notification_events
         WHERE user_id = ?1
           AND (read_at IS NULL OR trim(read_at) = '')
           AND (dismissed_at IS NULL OR trim(dismissed_at) = '')",
        [user_id],
        |row| row.get(0),
    )
}
