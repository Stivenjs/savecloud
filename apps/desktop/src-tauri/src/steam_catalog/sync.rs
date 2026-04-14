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

const MAX_BATCHES_PER_RUN: u32 = 10_000;
/// Pausa entre peticiones para evitar saturar la API de Steam.
const INTER_REQUEST: Duration = Duration::from_millis(250);
/// Edad máxima del último sync completo antes de forzar un rescaneo.
const FULL_CATALOG_MAX_AGE_SECS: u64 = 45 * 24 * 3600;
/// Versión de la lógica de paginación; si cambia, se fuerza sync completo.
const CATALOG_SYNC_LOGIC_VERSION: &str = "2-have-more-full-page";
/// Tamaño de los lotes de inserción en la base de datos.
const UPSERT_BATCH_SIZE: usize = 5_000;

/// Estadísticas del sync devueltas al caller.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSyncStats {
    pub mode: String,
    pub apps_upserted: u64,
    pub batches: u32,
}

/// Payload del evento Tauri `steam-catalog-sync-progress`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamCatalogSyncProgressPayload {
    pub mode: String,
    pub batch: u32,
    pub apps_upserted: u64,
    pub done: bool,
}

/// Emite el evento de progreso al frontend si hay un [`AppHandle`] disponible.
///
/// # Parameters
/// - `app`: Handle opcional de Tauri; si es `None`, la llamada es no-op.
/// - `payload`: Datos del progreso a emitir.
fn emit_progress(app: Option<&AppHandle>, payload: SteamCatalogSyncProgressPayload) {
    if let Some(a) = app {
        let _ = a.emit("steam-catalog-sync-progress", &payload);
    }
}

/// Devuelve los segundos transcurridos desde `UNIX_EPOCH`, o `0` en caso de error.
fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Obtiene la Steam Web API key desde la configuración o la variable de entorno.
///
/// # Returns
/// La clave como `String` si está presente y no vacía.
///
/// # Errors
/// [`CatalogSyncError::MissingApiKey`] si no se encuentra en ninguna fuente.
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

/// Hace upsert de un lote de apps ya normalizadas dentro de una transacción.
///
/// # Parameters
/// - `conn`: Conexión SQLite activa.
/// - `rows`: Tuplas `(app_id, name, name_normalized)` a insertar o actualizar.
///
/// # Returns
/// Número de filas afectadas.
///
/// # Errors
/// Propaga cualquier [`rusqlite::Error`] de la transacción o el statement.
fn upsert_apps_batch(
    conn: &Connection,
    rows: &[(u32, String, String)],
) -> Result<u64, rusqlite::Error> {
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

        for (app_id, name, nn) in rows {
            stmt.execute(rusqlite::params![app_id, name, nn])?;
            n += 1;
        }
    }

    tx.commit()?;
    Ok(n)
}

/// Calcula el siguiente cursor `last_appid` para la paginación de Steam.
///
/// Steam requiere el `app_id` más alto del lote anterior. Si la respuesta
/// fuera anómala (ningún id mayor al cursor enviado), avanza en 1 para
/// evitar un bucle infinito.
///
/// # Parameters
/// - `cursor_sent`: Valor de `last_appid` enviado en la petición anterior.
/// - `batch`: Apps devueltas por la API en esa petición.
///
/// # Returns
/// El nuevo cursor a usar en la siguiente petición.
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

/// Normaliza un lote de apps y las persiste en la base en chunks, en un
/// thread bloqueante para no detener el runtime de Tokio.
///
/// # Parameters
/// - `db`: Handle del pool de base de datos.
/// - `apps`: Apps crudas `(app_id, name)` recibidas de la API.
///
/// # Returns
/// Total de filas insertadas o actualizadas.
///
/// # Errors
/// Propaga [`SqliteError`](crate::sqlite::error::SqliteError) si falla
/// cualquier operación de escritura en la base de datos.
async fn persist_apps(
    db: &AppDb,
    apps: Vec<(u32, String)>,
) -> Result<u64, crate::sqlite::error::SqliteError> {
    let db_clone = db.clone();

    tokio::task::spawn_blocking(move || {
        let rows: Vec<(u32, String, String)> = apps
            .into_iter()
            .map(|(id, name)| {
                let nn = normalize_catalog_name(&name);
                (id, name, nn)
            })
            .collect();

        let mut total = 0u64;
        for chunk in rows.chunks(UPSERT_BATCH_SIZE) {
            total += db_clone.with_conn(|c| upsert_apps_batch(c, chunk))?;
        }
        Ok(total)
    })
    .await
    .expect("Panic en el worker thread de la base de datos")
}

/// Invalida el progreso del sync si el scope de `GetAppList` cambió.
///
/// # Errors
/// Propaga errores de lectura/escritura en la base de datos.
fn invalidate_sync_if_scope_mismatch(db: &AppDb) -> Result<(), CatalogSyncError> {
    let stored = db.with_conn(|c| get_meta(c, META_APP_LIST_SCOPE))?;
    if stored.as_deref() == Some(GET_APP_LIST_QUERY_INCLUDES) {
        return Ok(());
    }
    reset_catalog_sync_progress(db)
}

/// Invalida el progreso si la versión de lógica de paginación cambió.
///
/// Solo resetea si el sync completo ya había terminado; si estaba a medias,
/// no borra metadatos para no perder el progreso.
///
/// # Errors
/// Propaga errores de lectura/escritura en la base de datos.
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

/// Invalida el sync completo si supera [`FULL_CATALOG_MAX_AGE_SECS`].
///
/// Si la clave de timestamp no existe (base antigua), la inicializa con
/// la hora actual sin forzar un rescaneo inmediato.
///
/// # Errors
/// Propaga errores de lectura/escritura en la base de datos.
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
            let now = now_unix_secs().to_string();
            db.with_conn(|c| set_meta(c, META_FULL_CATALOG_COMPLETED_AT, &now))?;
            return Ok(());
        }
    };
    let Ok(ts) = ts_str.parse::<u64>() else {
        return reset_catalog_sync_progress(db);
    };
    if now_unix_secs().saturating_sub(ts) <= FULL_CATALOG_MAX_AGE_SECS {
        return Ok(());
    }
    reset_catalog_sync_progress(db)
}

/// Ejecuta un sync completo (o lo reanuda) o uno incremental según el estado
/// almacenado en `catalog_sync_meta`.
///
/// Orden de decisión:
/// 1. Valida que el scope y la versión de lógica no hayan cambiado.
/// 2. Verifica que el último sync completo no sea demasiado antiguo.
/// 3. Si `META_FULL_SYNC_DONE != "1"` → sync completo; si no → incremental.
/// 4. Si se insertaron apps nuevas, hace checkpoint `TRUNCATE` del WAL.
///
/// # Parameters
/// - `db`: Pool de conexiones SQLite.
/// - `app`: Handle opcional de Tauri para emitir eventos de progreso.
///
/// # Returns
/// [`CatalogSyncStats`] con el modo, número de batches y apps procesadas.
///
/// # Errors
/// - [`CatalogSyncError::MissingApiKey`] si no hay clave de API configurada.
/// - [`CatalogSyncError::BatchLimit`] si se supera [`MAX_BATCHES_PER_RUN`].
/// - [`CatalogSyncError::Http`] / [`CatalogSyncError::HttpStatus`] en fallos de red.
/// - [`CatalogSyncError::AppDb`] en fallos de base de datos.
pub async fn run_catalog_sync(
    db: &AppDb,
    app: Option<&AppHandle>,
) -> Result<CatalogSyncStats, CatalogSyncError> {
    let key = resolve_api_key()?;
    invalidate_sync_if_scope_mismatch(db)?;
    invalidate_sync_if_logic_version_mismatch(db)?;
    invalidate_sync_if_full_catalog_stale(db)?;

    // Backfill de catalog_rank_score para apps enriquecidas antes de la migración 016.
    // Solo corre si hay filas con score = 0 y details_json presente; en ejecuciones
    // posteriores la query devuelve 0 y el spawn_blocking termina instantáneamente.
    let db_score = db.clone();
    let _ = tokio::task::spawn_blocking(move || {
        db_score.with_conn(|conn| {
            let needs_backfill: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM steam_catalog_apps \
                     WHERE catalog_rank_score = 0 \
                       AND details_json IS NOT NULL \
                       AND length(trim(details_json)) > 2",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or(0);

            if needs_backfill > 0 {
                let _ = crate::steam_catalog::scoring::backfill_rank_scores(conn);
            }
            Ok::<_, rusqlite::Error>(())
        })
    })
    .await;

    let full_done = db
        .with_conn(|c| get_meta(c, META_FULL_SYNC_DONE))?
        .as_deref()
        == Some("1");

    let stats = if !full_done {
        run_full_sync(db, &key, app).await?
    } else {
        run_incremental_sync(db, &key, app).await?
    };

    if stats.apps_upserted > 0 {
        let _ = db.checkpoint("TRUNCATE");
    }

    Ok(stats)
}

/// Recorre la API de Steam desde el principio (o desde el último cursor
/// guardado) hasta agotar todas las páginas disponibles.
///
/// Al terminar persiste `META_FULL_SYNC_DONE = "1"` y los metadatos de
/// versión, scope y timestamp para que el próximo arranque haga incremental.
///
/// # Parameters
/// - `db`: Pool de conexiones SQLite.
/// - `key`: Steam Web API key.
/// - `app`: Handle opcional de Tauri para emitir progreso.
///
/// # Returns
/// [`CatalogSyncStats`] con `mode = "full"`.
///
/// # Errors
/// [`CatalogSyncError::BatchLimit`] si el loop supera [`MAX_BATCHES_PER_RUN`].
/// Otros errores de red o base de datos se propagan directamente.
async fn run_full_sync(
    db: &AppDb,
    key: &str,
    app: Option<&AppHandle>,
) -> Result<CatalogSyncStats, CatalogSyncError> {
    let mode = "full";
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
            total += persist_apps(db, apps.clone()).await?;
            last_appid = advance_last_appid(cursor_sent, &apps);
            db.with_conn(|c| set_meta(c, META_RESUME_LAST_APPID, &last_appid.to_string()))?;
        } else if have_more {
            // API devolvió vacío pero pide más: avanzar para no quedar en bucle.
            last_appid = last_appid.saturating_add(1);
            db.with_conn(|c| set_meta(c, META_RESUME_LAST_APPID, &last_appid.to_string()))?;
        }

        emit_progress(
            app,
            SteamCatalogSyncProgressPayload {
                mode: mode.to_string(),
                batch: batches,
                apps_upserted: total,
                done: false,
            },
        );

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
            emit_progress(
                app,
                SteamCatalogSyncProgressPayload {
                    mode: mode.to_string(),
                    batch: batches,
                    apps_upserted: total,
                    done: true,
                },
            );
            return Ok(CatalogSyncStats {
                mode: mode.to_string(),
                apps_upserted: total,
                batches,
            });
        }

        sleep(INTER_REQUEST).await;
    }
}

/// Consulta solo las apps modificadas desde el último sync (`if_modified_since`).
///
/// # Parameters
/// - `db`: Pool de conexiones SQLite.
/// - `key`: Steam Web API key.
/// - `app`: Handle opcional de Tauri para emitir progreso.
///
/// # Returns
/// [`CatalogSyncStats`] con `mode = "incremental"`.
///
/// # Errors
/// [`CatalogSyncError::BatchLimit`] si el loop supera [`MAX_BATCHES_PER_RUN`].
/// Otros errores de red o base de datos se propagan directamente.
async fn run_incremental_sync(
    db: &AppDb,
    key: &str,
    app: Option<&AppHandle>,
) -> Result<CatalogSyncStats, CatalogSyncError> {
    let mode = "incremental";
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
            total += persist_apps(db, apps.clone()).await?;
            last_appid = advance_last_appid(cursor_sent, &apps);
        } else if have_more {
            last_appid = last_appid.saturating_add(1);
        }

        emit_progress(
            app,
            SteamCatalogSyncProgressPayload {
                mode: mode.to_string(),
                batch: batches,
                apps_upserted: total,
                done: false,
            },
        );

        if !have_more {
            let ts = now_unix_secs();
            db.with_conn(|c| {
                set_meta(c, META_LAST_INCREMENTAL_AT, &ts.to_string())?;
                Ok::<(), rusqlite::Error>(())
            })?;
            emit_progress(
                app,
                SteamCatalogSyncProgressPayload {
                    mode: mode.to_string(),
                    batch: batches,
                    apps_upserted: total,
                    done: true,
                },
            );
            return Ok(CatalogSyncStats {
                mode: mode.to_string(),
                apps_upserted: total,
                batches,
            });
        }

        sleep(INTER_REQUEST).await;
    }
}

/// Fuerza un sync completo en la próxima ejecución borrando los metadatos
/// de progreso. No elimina las filas ya insertadas en `steam_catalog_apps`.
///
/// # Errors
/// Propaga cualquier [`CatalogSyncError`] devuelto por [`AppDb::with_conn`].
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
