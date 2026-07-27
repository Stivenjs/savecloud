//! Comandos Tauri del centro de notificaciones.

use tauri::{AppHandle, State};

use crate::config;
use crate::sqlite::AppDb;

use super::db;
use super::models::{ListNotificationsParams, NotificationRecordDto};
use super::sync_http;
use super::writer::emit_notifications_changed;

#[tauri::command]
pub fn list_notifications(
    db: State<'_, AppDb>,
    params: ListNotificationsParams,
) -> Result<Vec<NotificationRecordDto>, String> {
    let user_id = match config::load_config()
        .user_id
        .filter(|s| !s.trim().is_empty())
    {
        Some(u) => u,
        None => {
            return Err("Configura tu usuario en Configuración".to_string());
        }
    };

    let out = db.with_conn(|conn| {
        db::list_notifications(
            conn,
            &user_id,
            params.limit.max(1).min(200),
            params.offset.max(0),
            params.unread_only,
        )
    });

    out.map_err(|e: crate::sqlite::error::SqliteError| e.to_string())
}

#[tauri::command]
pub fn notification_unread_count(db: State<'_, AppDb>) -> Result<i64, String> {
    let user_id = match config::load_config()
        .user_id
        .filter(|s| !s.trim().is_empty())
    {
        Some(u) => u,
        None => {
            return Err("Configura tu usuario en Configuración".to_string());
        }
    };

    let out = db.with_conn(|conn| db::unread_count(conn, &user_id));
    out.map_err(|e: crate::sqlite::error::SqliteError| e.to_string())
}

#[tauri::command]
pub fn mark_notification_read(db: State<'_, AppDb>, id: String) -> Result<(), String> {
    let user_id = config::load_config()
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu usuario en Configuración")?;

    db.with_conn(|conn| db::mark_read(conn, &user_id, &id))
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    let ids = vec![id.clone()];
    tauri::async_runtime::spawn(async move {
        let _ = sync_http::ack_remote(ids, true, false).await;
    });

    Ok(())
}

#[tauri::command]
pub fn mark_all_notifications_read(db: State<'_, AppDb>) -> Result<(), String> {
    let user_id = config::load_config()
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu usuario en Configuración")?;

    let ids: Vec<String> = db
        .with_conn(|conn| {
            let rows = db::list_notifications(conn, &user_id, 10_000, 0, true)?;
            Ok(rows.into_iter().map(|r| r.id).collect())
        })
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    db.with_conn(|conn| db::mark_all_read(conn, &user_id))
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        let _ = sync_http::ack_remote(ids, true, false).await;
    });

    Ok(())
}

#[tauri::command]
pub fn dismiss_notification(db: State<'_, AppDb>, id: String) -> Result<(), String> {
    let user_id = config::load_config()
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu usuario en Configuración")?;

    db.with_conn(|conn| db::dismiss(conn, &user_id, &id))
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    let ids = vec![id];
    tauri::async_runtime::spawn(async move {
        let _ = sync_http::ack_remote(ids, false, true).await;
    });

    Ok(())
}

#[tauri::command]
pub fn dismiss_all_notifications(db: State<'_, AppDb>) -> Result<(), String> {
    let user_id = config::load_config()
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu usuario en Configuración")?;

    let ids: Vec<String> = db
        .with_conn(|conn| {
            let rows = db::list_notifications(conn, &user_id, 10_000, 0, false)?;
            Ok(rows.into_iter().map(|r| r.id).collect())
        })
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    db.with_conn(|conn| db::dismiss_all(conn, &user_id))
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    tauri::async_runtime::spawn(async move {
        let _ = sync_http::ack_remote(ids, false, true).await;
    });

    Ok(())
}

#[tauri::command]
pub async fn sync_notifications_push(db: State<'_, AppDb>) -> Result<usize, String> {
    sync_notifications_push_internal(&db).await
}

async fn sync_notifications_push_internal(db: &AppDb) -> Result<usize, String> {
    let user_id = config::load_config()
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu usuario en Configuración")?;

    let pending: Vec<NotificationRecordDto> = db
        .with_conn(|conn| db::list_pending_sync(conn, &user_id, 200))
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    if pending.is_empty() {
        return Ok(0);
    }

    let ids: Vec<String> = pending.iter().map(|p| p.id.clone()).collect();
    sync_http::push_batch(pending).await?;

    db.with_conn(|conn| db::clear_pending_sync(conn, &ids))
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;
    Ok(ids.len())
}

#[tauri::command]
pub async fn sync_notifications_pull(
    app: AppHandle,
    db: State<'_, AppDb>,
) -> Result<usize, String> {
    sync_notifications_pull_internal(&app, &db, true).await
}

async fn sync_notifications_pull_internal(app: &AppHandle, db: &AppDb, emit: bool) -> Result<usize, String> {
    let user_id = config::load_config()
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu usuario en Configuración")?;

    let cursor_key = format!("{user_id}:last_pull_cursor");
    let cursor = db::get_meta(db, &cursor_key)
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?
        .or_else(|| db::get_meta(db, "last_pull_cursor").ok().flatten())
        .filter(|s| !s.trim().is_empty());

    let resp = sync_http::pull_since(cursor.as_deref(), 200)
        .await?;
    let items = resp.items;
    let n = items.len();
    if n == 0 {
        return Ok(0);
    }

    let next = items.iter().map(|i| i.updated_at.clone()).max();

    let mut merged = 0usize;
    for mut item in items {
        item.user_id = user_id.clone();
        item.pending_sync = false;
        if item.server_updated_at.is_none() {
            item.server_updated_at = Some(item.updated_at.clone());
        }
        db.with_conn(|conn| db::upsert_merged(conn, &mut item))
            .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;
        merged += 1;
    }

    if let Some(c) = next {
        db::set_meta(db, &cursor_key, &c)
            .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;
    }

    if merged > 0 && emit {
        emit_notifications_changed(app);
    }

    Ok(merged)
}

#[tauri::command]
pub async fn sync_notifications_full(
    app: AppHandle,
    db: State<'_, AppDb>,
    params: ListNotificationsParams,
) -> Result<super::models::NotificationSyncFullResponse, String> {
    // 1. Push
    let _ = sync_notifications_push_internal(&db).await;
    // 2. Pull (silent: we will return the data ourselves)
    let _ = sync_notifications_pull_internal(&app, &db, false).await;

    // 3. Get latest data
    let user_id = config::load_config()
        .user_id
        .filter(|s| !s.trim().is_empty())
        .ok_or("Configura tu usuario en Configuración")?;

    let items = db.with_conn(|conn| {
        db::list_notifications(
            conn,
            &user_id,
            params.limit.max(1).min(200),
            params.offset.max(0),
            params.unread_only,
        )
    }).map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    let unread_count = db.with_conn(|conn| db::unread_count(conn, &user_id))
        .map_err(|e: crate::sqlite::error::SqliteError| e.to_string())?;

    Ok(super::models::NotificationSyncFullResponse {
        items,
        unread_count,
    })
}
