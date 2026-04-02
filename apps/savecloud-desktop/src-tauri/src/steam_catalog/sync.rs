//! Orquestación: sync completo (primera vez o reanudación) vs incremental (`if_modified_since`).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::Connection;
use tauri::{AppHandle, Emitter};
use tokio::time::sleep;

use crate::config::load_settings;
use crate::sqlite::AppDb;

use super::api::{fetch_app_list_page, GET_APP_LIST_QUERY_INCLUDES};
use super::error::CatalogSyncError;
use super::meta::{
    delete_meta, get_meta, set_meta, META_APP_LIST_SCOPE, META_CATALOG_SYNC_LOGIC_VERSION,
    META_FULL_CATALOG_COMPLETED_AT, META_FULL_SYNC_DONE, META_LAST_INCREMENTAL_AT,
    META_RESUME_LAST_APPID,
};
use super::normalize::normalize_catalog_name;

/// Máximo de peticiones por ejecución para evitar bucles infinitos ante respuestas anómalas.
const MAX_BATCHES_PER_RUN: u32 = 10_000;
/// Pausa entre peticiones a la API de Steam para reducir 429.
const INTER_REQUEST: Duration = Duration::from_millis(250);

/// Steam no garantiza que `if_modified_since` cubra todo el catálogo; un paso completo por `last_appid` de vez en cuando
/// recoge juegos nuevos y cambios que el incremental pudo omitir.
const FULL_CATALOG_MAX_AGE_SECS: u64 = 45 * 24 * 3600;

/// Subir cuando cambie la paginación / interpretación de `have_more` (p. ej. lote de 50k con `have_more: false`).
const CATALOG_SYNC_LOGIC_VERSION: &str = "2-have-more-full-page";

/// Resultado expuesto al frontend tras un sync.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSyncStats {
    pub mode: String,
    pub apps_upserted: u64,
    pub batches: u32,
}

/// Progreso por lote hacia el frontend (no hay total conocido de antemano).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamCatalogSyncProgressPayload {
    pub mode: String,
    pub batch: u32,
    pub apps_upserted: u64,
    pub done: bool,
}

fn emit_steam_catalog_progress(app: Option<&AppHandle>, payload: SteamCatalogSyncProgressPayload) {
    if let Some(a) = app {
        let _ = a.emit("steam-catalog-sync-progress", &payload);
    }
}

fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn resolve_api_key() -> Result<String, CatalogSyncError> {
    let s = load_settings();
    s.steam_web_api_key
        .as_ref()
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
        .or_else(|| {
            std::env::var("STEAM_WEB_API_KEY")
                .ok()
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
        })
        .ok_or(CatalogSyncError::MissingApiKey)
}

fn upsert_apps_batch(conn: &Connection, rows: &[(u32, String)]) -> Result<u64, rusqlite::Error> {
    let mut n = 0u64;

    let tx = conn.unchecked_transaction()?;

    {
        let mut stmt = tx.prepare_cached(
            "INSERT INTO steam_catalog_apps (app_id, name, name_normalized, last_sync_batch_at)
             VALUES (?1, ?2, ?3, unixepoch())
             ON CONFLICT(app_id) DO UPDATE SET
               name = excluded.name,
               name_normalized = excluded.name_normalized,
               last_sync_batch_at = unixepoch()",
        )?;

        for (app_id, name) in rows {
            let nn = normalize_catalog_name(name);
            stmt.execute(rusqlite::params![app_id, name, nn])?;
            n += 1;
        }
    }

    tx.commit()?;

    Ok(n)
}

/// Cursor para la siguiente petición `last_appid`. Steam pide el último appid del lote (orden ascendente → el máximo).
/// Si la respuesta fuera anómala (ningún id > al enviado), forzamos `sent + 1` para no repetir el mismo lote en bucle.
fn advance_last_appid(cursor_sent: u32, batch: &[(u32, String)]) -> u32 {
    let Some(max_id) = batch.iter().map(|(id, _)| *id).max() else {
        return cursor_sent.saturating_add(1);
    };
    if max_id > cursor_sent {
        max_id
    } else {
        cursor_sent.saturating_add(1)
    }
}

#[cfg(test)]
mod cursor_tests {
    use super::advance_last_appid;

    #[test]
    fn next_page_uses_max_appid_in_batch() {
        assert_eq!(
            advance_last_appid(10, &[(100, "a".into()), (50, "b".into())]),
            100
        );
    }

    #[test]
    fn stale_batch_must_not_repeat_same_cursor() {
        assert_eq!(advance_last_appid(500, &[(100, "x".into())]), 501);
    }

    #[test]
    fn duplicate_max_equal_to_sent_advances() {
        assert_eq!(advance_last_appid(42, &[(42, "dup".into())]), 43);
    }
}

/// Si cambian los flags `include_*` de [`GET_APP_LIST_QUERY_INCLUDES`], el incremental no rellena tipos viejos:
/// borramos el progreso y el próximo sync vuelve a ser completo.
fn invalidate_sync_if_scope_mismatch(db: &AppDb) -> Result<(), CatalogSyncError> {
    let stored = db.with_conn(|c| get_meta(c, META_APP_LIST_SCOPE))?;
    if stored.as_deref() == Some(GET_APP_LIST_QUERY_INCLUDES) {
        return Ok(());
    }
    reset_catalog_sync_progress(db)
}

fn invalidate_sync_if_logic_version_mismatch(db: &AppDb) -> Result<(), CatalogSyncError> {
    let stored = db.with_conn(|c| get_meta(c, META_CATALOG_SYNC_LOGIC_VERSION))?;
    if stored.as_deref() == Some(CATALOG_SYNC_LOGIC_VERSION) {
        return Ok(());
    }
    let full_done = db
        .with_conn(|c| get_meta(c, META_FULL_SYNC_DONE))?
        .as_deref()
        == Some("1");
    if !full_done {
        // Ya reindexando o sync incompleto; no volver a borrar metadatos.
        return Ok(());
    }
    db.with_conn(|c| {
        delete_meta(c, META_FULL_SYNC_DONE)?;
        delete_meta(c, META_RESUME_LAST_APPID)?;
        delete_meta(c, META_LAST_INCREMENTAL_AT)?;
        delete_meta(c, META_FULL_CATALOG_COMPLETED_AT)?;
        Ok(())
    })?;
    Ok(())
}

/// Si el último sync completo es antiguo, fuerza otro (misma lógica que reset manual).
fn invalidate_sync_if_full_catalog_stale(db: &AppDb) -> Result<(), CatalogSyncError> {
    let full_done = db
        .with_conn(|c| get_meta(c, META_FULL_SYNC_DONE))?
        .as_deref()
        == Some("1");
    if !full_done {
        return Ok(());
    }
    let ts_str = db.with_conn(|c| get_meta(c, META_FULL_CATALOG_COMPLETED_AT))?;
    let ts_str = match ts_str {
        Some(s) if !s.is_empty() => s,
        _ => {
            // Bases antiguas sin esta clave: no forzar un full inmediato; empezar a contar desde ahora.
            let now = now_unix_secs().to_string();
            db.with_conn(|c| set_meta(c, META_FULL_CATALOG_COMPLETED_AT, &now))?;
            return Ok(());
        }
    };
    let Ok(ts) = ts_str.parse::<u64>() else {
        return reset_catalog_sync_progress(db);
    };
    let age = now_unix_secs().saturating_sub(ts);
    if age <= FULL_CATALOG_MAX_AGE_SECS {
        return Ok(());
    }
    reset_catalog_sync_progress(db)
}

/// Ejecuta un sync completo (o reanuda) o uno incremental según metadatos en `catalog_sync_meta`.
pub async fn run_catalog_sync(
    db: &AppDb,
    app: Option<&AppHandle>,
) -> Result<CatalogSyncStats, CatalogSyncError> {
    let key = resolve_api_key()?;
    invalidate_sync_if_scope_mismatch(db)?;
    invalidate_sync_if_logic_version_mismatch(db)?;
    invalidate_sync_if_full_catalog_stale(db)?;
    
    let full_done = db
        .with_conn(|c| get_meta(c, META_FULL_SYNC_DONE))?
        .as_deref()
        == Some("1");

    let stats = if !full_done {
        run_full_sync(db, &key, app).await?
    } else {
        run_incremental_sync(db, &key, app).await?
    };

    // Si la sincronización trajo datos nuevos (se actualizó o insertó al menos 1 app),
    // hacemos un checkpoint para consolidar el archivo WAL y ahorrar espacio en disco.
    if stats.apps_upserted > 0 {
        let _ = db.checkpoint("TRUNCATE");
    }

    Ok(stats)
}

async fn run_full_sync(
    db: &AppDb,
    key: &str,
    app: Option<&AppHandle>,
) -> Result<CatalogSyncStats, CatalogSyncError> {
    let mut last_appid: u32 = db
        .with_conn(|c| get_meta(c, META_RESUME_LAST_APPID))?
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let mut total: u64 = 0;
    let mut batches: u32 = 0;

    loop {
        batches += 1;
        if batches > MAX_BATCHES_PER_RUN {
            return Err(CatalogSyncError::BatchLimit);
        }

        let cursor_sent = last_appid;
        let (apps, have_more) = fetch_app_list_page(key, last_appid, None).await?;
        if !apps.is_empty() {
            let n = db.with_conn(|c| upsert_apps_batch(c, &apps))?;
            total += n;
            last_appid = advance_last_appid(cursor_sent, &apps);
            db.with_conn(|c| set_meta(c, META_RESUME_LAST_APPID, &last_appid.to_string()))?;
        }

        emit_steam_catalog_progress(
            app,
            SteamCatalogSyncProgressPayload {
                mode: "full".to_string(),
                batch: batches,
                apps_upserted: total,
                done: false,
            },
        );

        sleep(INTER_REQUEST).await;

        if !have_more {
            let ts = now_unix_secs();
            db.with_conn(|c| {
                set_meta(c, META_FULL_SYNC_DONE, "1")?;
                delete_meta(c, META_RESUME_LAST_APPID)?;
                set_meta(c, META_LAST_INCREMENTAL_AT, &ts.to_string())?;
                set_meta(c, META_APP_LIST_SCOPE, GET_APP_LIST_QUERY_INCLUDES)?;
                set_meta(c, META_FULL_CATALOG_COMPLETED_AT, &ts.to_string())?;
                set_meta(
                    c,
                    META_CATALOG_SYNC_LOGIC_VERSION,
                    CATALOG_SYNC_LOGIC_VERSION,
                )?;
                Ok::<(), rusqlite::Error>(())
            })?;
            emit_steam_catalog_progress(
                app,
                SteamCatalogSyncProgressPayload {
                    mode: "full".to_string(),
                    batch: batches,
                    apps_upserted: total,
                    done: true,
                },
            );
            return Ok(CatalogSyncStats {
                mode: "full".to_string(),
                apps_upserted: total,
                batches,
            });
        }

        if apps.is_empty() && have_more {
            // Evitar bucle si la API devuelve vacío pero pide más: avanzar de todos modos.
            last_appid = last_appid.saturating_add(1);
            db.with_conn(|c| set_meta(c, META_RESUME_LAST_APPID, &last_appid.to_string()))?;
        }
    }
}

async fn run_incremental_sync(
    db: &AppDb,
    key: &str,
    app: Option<&AppHandle>,
) -> Result<CatalogSyncStats, CatalogSyncError> {
    let since: u32 = db
        .with_conn(|c| get_meta(c, META_LAST_INCREMENTAL_AT))?
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

    let mut last_appid: u32 = 0;
    let mut total: u64 = 0;
    let mut batches: u32 = 0;

    loop {
        batches += 1;
        if batches > MAX_BATCHES_PER_RUN {
            return Err(CatalogSyncError::BatchLimit);
        }

        let cursor_sent = last_appid;
        let (apps, have_more) = fetch_app_list_page(key, last_appid, Some(since)).await?;
        if !apps.is_empty() {
            let n = db.with_conn(|c| upsert_apps_batch(c, &apps))?;
            total += n;
            last_appid = advance_last_appid(cursor_sent, &apps);
        }

        emit_steam_catalog_progress(
            app,
            SteamCatalogSyncProgressPayload {
                mode: "incremental".to_string(),
                batch: batches,
                apps_upserted: total,
                done: false,
            },
        );

        sleep(INTER_REQUEST).await;

        if !have_more {
            let ts = now_unix_secs();
            db.with_conn(|c| {
                set_meta(c, META_LAST_INCREMENTAL_AT, &ts.to_string())?;
                Ok::<(), rusqlite::Error>(())
            })?;
            emit_steam_catalog_progress(
                app,
                SteamCatalogSyncProgressPayload {
                    mode: "incremental".to_string(),
                    batch: batches,
                    apps_upserted: total,
                    done: true,
                },
            );
            return Ok(CatalogSyncStats {
                mode: "incremental".to_string(),
                apps_upserted: total,
                batches,
            });
        }

        if apps.is_empty() && have_more {
            last_appid = last_appid.saturating_add(1);
        }
    }
}

/// Fuerza un sync completo en la próxima ejecución (borra metadatos de progreso).
/// Útil para “reset” manual; no borra filas ya insertadas.
pub fn reset_catalog_sync_progress(db: &AppDb) -> Result<(), CatalogSyncError> {
    db.with_conn(|c| {
        delete_meta(c, META_FULL_SYNC_DONE)?;
        delete_meta(c, META_RESUME_LAST_APPID)?;
        delete_meta(c, META_LAST_INCREMENTAL_AT)?;
        delete_meta(c, META_FULL_CATALOG_COMPLETED_AT)?;
        delete_meta(c, META_CATALOG_SYNC_LOGIC_VERSION)?;
        Ok::<(), rusqlite::Error>(())
    })?;
    Ok(())
}
