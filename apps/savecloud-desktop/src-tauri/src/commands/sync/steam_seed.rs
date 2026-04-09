//! Seed cloud de Steam: exportar manifest a S3 vía API, resetear estado e importar batches a SQLite.

use super::api::api_request;
use super::context::resolve_api_context;
use super::context::ApiContext;
use crate::network::API_CLIENT;
use crate::sqlite::error::SqliteError;
use crate::sqlite::AppDb;
use crate::steam_catalog::normalize::normalize_catalog_name;
use crate::steam_catalog::trending::{replace_trending_app_ids, sync_store_trending};
use futures_util::stream::{self, StreamExt};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone)]
struct SteamSeedImportState {
    strategy: String,
    cursor_last_key: Option<String>,
    newest_watermark: Option<String>,
    max_imported_batch_key: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedUploadUrlResponse {
    upload_url: String,
    #[serde(rename = "key")]
    _key: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedBatchesResponse {
    keys: Vec<String>,
    next_cursor: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedBatchDownloadUrlResult {
    key: String,
    url: Option<String>,
    #[allow(dead_code)]
    error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedBatchDownloadUrlsResponse {
    results: Vec<SteamSeedBatchDownloadUrlResult>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedPriorityDownloadUrlResponse {
    download_url: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedBatchLine {
    app_id: u32,
    #[serde(default)]
    steam_success: Option<bool>,
    #[serde(default)]
    data: Option<serde_json::Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedExportResultDto {
    pub app_ids_exported: u32,
    pub parts_uploaded: u32,
    pub priority_ids_uploaded: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedImportResultDto {
    pub batches_processed: u32,
    pub rows_updated: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedImportProgressPayload {
    pub iteration: u32,
    pub batches_this_round: u32,
    pub rows_this_round: u32,
    pub total_batches: u32,
    pub total_rows_updated: u32,
    pub done: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedImportRunResultDto {
    pub rounds: u32,
    pub batches_processed: u32,
    pub rows_updated: u32,
    pub trending_priority_entries: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SteamSeedRemoteStatusDto {
    last_batch_key: Option<String>,
    #[allow(dead_code)]
    batch_seq: u32,
    #[allow(dead_code)]
    catalog_complete: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamSeedFreshnessDto {
    pub status: String,
    pub cloud_last_batch_key: Option<String>,
    pub local_max_batch_key: Option<String>,
    pub error: Option<String>,
}

/// Límite de rondas por ejecución para prevenir bucles infinitos ante respuestas
/// anómalas de la API.
const STEAM_SEED_IMPORT_MAX_ROUNDS: u32 = 5000;

/// Devuelve la clave de batch local más avanzada conocida, priorizando
/// `max_imported_batch_key` sobre `cursor_last_key`.
///
/// # Parameters
/// - `state`: Estado de importación actual leído desde SQLite.
///
/// # Returns
/// `Some(key)` con la clave más alta conocida, o `None` si no hay historial.
fn effective_local_max_imported(state: &SteamSeedImportState) -> Option<String> {
    state
        .max_imported_batch_key
        .clone()
        .or_else(|| state.cursor_last_key.clone())
}

/// Extrae el prefijo `steam-seed/{ownerId}` de una clave S3 completa.
///
/// El prefijo termina justo antes del segmento `/batches/`, que marca la
/// frontera entre el scope del propietario y el nombre del batch.
///
/// # Parameters
/// - `key`: Clave S3 completa, p.ej. `steam-seed/abc123/batches/00000001.jsonl`.
///
/// # Returns
/// `Some(&str)` con el prefijo hasta (sin incluir) `/batches/`, o `None` si
/// la clave no contiene ese segmento.
fn steam_seed_scope_prefix(key: &str) -> Option<&str> {
    key.find("/batches/").map(|i| &key[..i])
}

/// Valida que `local_max` y `cloud_last` pertenecen al mismo scope S3
/// (`steam-seed/{ownerId}`) antes de usarlos en la comparación de frescura.
///
/// Impide que un invitado que cambia de nube propia a la del anfitrión
/// (o entre anfitriones) mezcle claves de propietarios distintos.
///
/// # Parameters
/// - `cloud_last`: Clave del último batch en la nube, o `None`.
/// - `local_max`: Clave local máxima importada, o `None`.
///
/// # Returns
/// `Some(local_max)` si ambas claves comparten el mismo prefijo de scope;
/// `None` en cualquier otro caso.
fn local_max_if_same_scope_as_cloud<'a>(
    cloud_last: Option<&'a str>,
    local_max: Option<&'a str>,
) -> Option<&'a str> {
    let cloud = cloud_last.filter(|s| !s.is_empty())?;
    let local = local_max?;
    match (
        steam_seed_scope_prefix(cloud),
        steam_seed_scope_prefix(local),
    ) {
        (Some(pc), Some(pl)) if pc == pl => Some(local),
        _ => None,
    }
}

/// Calcula el estado de frescura del seed comparando la clave de nube con la local.
///
/// # Parameters
/// - `cloud_last`: Último batch publicado en la nube, o `None` si no existe.
/// - `local_max`: Máxima clave de batch importada localmente, o `None`.
///
/// # Returns
/// Uno de los literales estáticos:
/// - `"no_cloud_batches"`: la nube no tiene batches.
/// - `"no_local_import"`: hay batches en la nube pero ninguno importado aún.
/// - `"stale"`: la nube tiene batches más nuevos que el máximo local.
/// - `"up_to_date"`: el local está a la par o por delante de la nube.
fn compute_steam_seed_freshness_status(
    cloud_last: Option<&str>,
    local_max: Option<&str>,
) -> &'static str {
    let cloud = match cloud_last {
        None => return "no_cloud_batches",
        Some(s) if s.is_empty() => return "no_cloud_batches",
        Some(s) => s,
    };
    match local_max {
        None => "no_local_import",
        Some(l) if cloud > l => "stale",
        Some(_) => "up_to_date",
    }
}

/// Valida y normaliza el nombre de la estrategia de importación.
///
/// # Parameters
/// - `s`: Valor crudo del parámetro `strategy`, o `None` para usar el defecto.
///
/// # Returns
/// `Ok("cursor")` o `Ok("newest_first")` según corresponda;
/// `Err(String)` con mensaje descriptivo si el valor no es reconocido.
fn parse_import_strategy(s: Option<&str>) -> Result<String, String> {
    match s.map(str::trim).filter(|x| !x.is_empty()) {
        None => Ok("cursor".to_string()),
        Some(x) if x.eq_ignore_ascii_case("cursor") => Ok("cursor".to_string()),
        Some(x) if x.eq_ignore_ascii_case("newest_first") => Ok("newest_first".to_string()),
        Some(x) => Err(format!(
            "strategy inválida: {} (usa 'cursor' o 'newest_first')",
            x
        )),
    }
}

/// Lee todos los `app_id` del catálogo Steam en orden ascendente.
///
/// # Parameters
/// - `conn`: Conexión SQLite activa.
///
/// # Returns
/// `Vec<u32>` con los IDs; excluye valores ≤ 0.
///
/// # Errors
/// Propaga cualquier [`rusqlite::Error`] de la consulta.
fn list_all_catalog_app_ids(conn: &Connection) -> Result<Vec<u32>, rusqlite::Error> {
    let mut stmt =
        conn.prepare_cached("SELECT app_id FROM steam_catalog_apps ORDER BY app_id ASC")?;
    let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
    let mut out = Vec::new();
    for r in rows {
        let id = r?;
        if id > 0 {
            out.push(id as u32);
        }
    }
    Ok(out)
}

/// Lee los IDs de las apps en tendencia, ordenados por rango ascendente.
///
/// # Parameters
/// - `conn`: Conexión SQLite activa.
///
/// # Returns
/// `Vec<u32>` con los IDs; excluye valores ≤ 0.
///
/// # Errors
/// Propaga cualquier [`rusqlite::Error`] de la consulta.
fn list_trending_app_ids(conn: &Connection) -> Result<Vec<u32>, rusqlite::Error> {
    let mut stmt = conn.prepare_cached(
        "SELECT app_id FROM steam_catalog_trending
         WHERE app_id > 0
         ORDER BY rank ASC, app_id ASC",
    )?;
    let rows = stmt.query_map([], |row| row.get::<_, i64>(0))?;
    let mut out = Vec::new();
    for r in rows {
        let id = r?;
        if id > 0 {
            out.push(id as u32);
        }
    }
    Ok(out)
}

/// Carga el estado de importación desde SQLite, creando la fila inicial si no existe.
///
/// Se usa un enfoque iterativo en lugar de recursivo para evitar stack overflow
/// en entornos con límites de pila ajustados.
///
/// # Parameters
/// - `conn`: Conexión SQLite activa.
///
/// # Returns
/// El [`SteamSeedImportState`] persistido, o un estado vacío recién insertado.
///
/// # Errors
/// Propaga [`rusqlite::Error`] de cualquier operación de lectura o escritura.
fn load_or_init_import_state(conn: &Connection) -> Result<SteamSeedImportState, rusqlite::Error> {
    // Intenta INSERT OR IGNORE para garantizar que la fila existe, luego lee.
    // Evita la recursión del patrón original (query → no row → insert → recurse).
    conn.execute(
        "INSERT OR IGNORE INTO steam_seed_import_state (id) VALUES (1)",
        [],
    )?;
    conn.query_row(
        "SELECT strategy, cursor_last_key, newest_watermark, max_imported_batch_key
         FROM steam_seed_import_state WHERE id = 1",
        [],
        |row| {
            Ok(SteamSeedImportState {
                strategy: row.get(0)?,
                cursor_last_key: row.get(1)?,
                newest_watermark: row.get(2)?,
                max_imported_batch_key: row.get(3)?,
            })
        },
    )
}

/// Persiste el estado de importación en SQLite.
///
/// # Parameters
/// - `conn`: Conexión SQLite activa.
/// - `state`: Estado actualizado a escribir.
///
/// # Errors
/// Propaga [`rusqlite::Error`] si el UPDATE falla.
fn save_import_state(
    conn: &Connection,
    state: &SteamSeedImportState,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE steam_seed_import_state
         SET strategy = ?1, cursor_last_key = ?2, newest_watermark = ?3,
             max_imported_batch_key = ?4, updated_at = unixepoch()
         WHERE id = 1",
        rusqlite::params![
            state.strategy,
            state.cursor_last_key,
            state.newest_watermark,
            state.max_imported_batch_key,
        ],
    )?;
    Ok(())
}

/// Hace upsert masivo de apps enriquecidas y sincroniza facets + FTS en una
/// sola pasada SQL al final del batch.
///
/// # Estrategia
/// 1. Deshabilita triggers recursivos con `PRAGMA recursive_triggers = OFF`
///    para evitar O(n) disparos de parseo JSON durante el upsert.
/// 2. Registra los `app_id` procesados en `_seed_batch_ids` (tabla temporal).
/// 3. Sincroniza géneros, tags y FTS en una sola pasada SQL sobre el batch.
/// 4. Delega el cálculo de `rank_score` a
///    [`crate::steam_catalog::scoring::update_rank_scores_for_batch`], que
///    requiere lógica Rust (parseo de `release_date` con múltiples formatos y
///    ponderación de señales heterogéneas).
///
/// # Parameters
/// - `conn`: Conexión SQLite activa.
/// - `updates`: Slice de tuplas `(app_id, details_json)` a insertar o actualizar.
///
/// # Returns
/// Número de filas afectadas en `steam_catalog_apps`.
///
/// # Errors
/// Propaga [`rusqlite::Error`] de cualquier operación dentro de la transacción.
fn apply_seed_updates(
    conn: &Connection,
    updates: &[(u32, String)],
) -> Result<u32, rusqlite::Error> {
    if updates.is_empty() {
        return Ok(0);
    }

    let tx = conn.unchecked_transaction()?;

    tx.execute_batch(
        "PRAGMA recursive_triggers = OFF;
         CREATE TEMP TABLE IF NOT EXISTS _seed_batch_ids (app_id INTEGER PRIMARY KEY);
         DELETE FROM _seed_batch_ids;",
    )?;

    let mut updated: u32 = 0;

    {
        // Upsert principal: conserva el nombre ya existente si no era nulo/vacío.
        let mut upsert = tx.prepare_cached(
            "INSERT INTO steam_catalog_apps (
                app_id, name, name_normalized, details_json, enriched_at, last_sync_batch_at
             )
             VALUES (?1, ?2, ?3, ?4, unixepoch(), unixepoch())
             ON CONFLICT(app_id) DO UPDATE SET
                details_json    = excluded.details_json,
                enriched_at     = unixepoch(),
                name            = CASE
                                      WHEN steam_catalog_apps.name IS NULL
                                        OR steam_catalog_apps.name = ''
                                      THEN excluded.name
                                      ELSE steam_catalog_apps.name
                                  END,
                name_normalized = CASE
                                      WHEN steam_catalog_apps.name_normalized IS NULL
                                        OR steam_catalog_apps.name_normalized = ''
                                      THEN excluded.name_normalized
                                      ELSE steam_catalog_apps.name_normalized
                                  END",
        )?;

        // Registro de IDs procesados para la sincronización de facets posterior.
        let mut track =
            tx.prepare_cached("INSERT OR IGNORE INTO _seed_batch_ids (app_id) VALUES (?1)")?;

        for (app_id, json) in updates {
            let name =
                infer_name_from_details_json(json).unwrap_or_else(|| format!("App {}", app_id));
            let name_norm = normalize_catalog_name(&name);
            let n = upsert.execute(rusqlite::params![app_id, name, name_norm, json])?;
            updated = updated.saturating_add(n as u32);
            track.execute(rusqlite::params![app_id])?;
        }
    }

    // Sincronización de géneros, tags y FTS en una sola pasada sobre el batch,
    // equivalente a los triggers fila-a-fila pero sin su overhead O(n).
    tx.execute_batch(
        "
        -- Géneros: reemplazar solo los del batch actual
        DELETE FROM steam_app_genres
        WHERE app_id IN (SELECT app_id FROM _seed_batch_ids);

        INSERT OR IGNORE INTO steam_app_genres (app_id, label)
        SELECT
            a.app_id,
            CASE
                WHEN json_valid(g.value) AND json_type(g.value) = 'object'
                THEN COALESCE(NULLIF(json_extract(g.value, '$.description'), ''), g.value)
                ELSE g.value
            END
        FROM steam_catalog_apps a,
             json_each(
                 CASE
                     WHEN json_valid(a.details_json)
                       AND json_type(json_extract(a.details_json, '$.genres')) = 'array'
                     THEN json_extract(a.details_json, '$.genres')
                     ELSE '[]'
                 END
             ) AS g
        WHERE a.app_id IN (SELECT app_id FROM _seed_batch_ids)
          AND a.details_json IS NOT NULL
          AND length(trim(a.details_json)) > 0;

        -- Tags: reemplazar solo los del batch actual
        DELETE FROM steam_app_tags
        WHERE app_id IN (SELECT app_id FROM _seed_batch_ids);

        INSERT OR IGNORE INTO steam_app_tags (app_id, label)
        SELECT
            a.app_id,
            CASE
                WHEN json_valid(t.value) AND json_type(t.value) = 'object'
                THEN COALESCE(NULLIF(json_extract(t.value, '$.description'), ''), t.value)
                ELSE t.value
            END
        FROM steam_catalog_apps a,
             json_each(
                 CASE
                     WHEN json_valid(a.details_json)
                       AND json_type(json_extract(a.details_json, '$.categories')) = 'array'
                     THEN json_extract(a.details_json, '$.categories')
                     ELSE '[]'
                 END
             ) AS t
        WHERE a.app_id IN (SELECT app_id FROM _seed_batch_ids)
          AND a.details_json IS NOT NULL
          AND length(trim(a.details_json)) > 0;

        -- FTS: reemplazar entradas del batch
        DELETE FROM steam_catalog_search
        WHERE app_id IN (SELECT app_id FROM _seed_batch_ids);

        INSERT INTO steam_catalog_search (app_id, name_normalized)
        SELECT app_id, name_normalized
        FROM steam_catalog_apps
        WHERE app_id IN (SELECT app_id FROM _seed_batch_ids)
          AND name_normalized IS NOT NULL;
        ",
    )?;

    crate::steam_catalog::scoring::update_rank_scores_for_batch(&tx)?;

    tx.commit()?;
    Ok(updated)
}

/// Extrae el campo `name` del JSON de detalles de una app Steam.
///
/// Se realiza en Rust (no en SQL) para reutilizar el valor ya parseado en el
/// upsert y evitar un `json_extract` adicional por fila en SQLite.
///
/// # Parameters
/// - `details_json`: JSON crudo de detalles de la app.
///
/// # Returns
/// `Some(name)` si el campo existe y no está vacío; `None` en caso contrario.
#[inline]
fn infer_name_from_details_json(details_json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(details_json).ok()?;
    let name = v.get("name")?.as_str()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Obtiene una página del listado de batches S3.
///
/// # Parameters
/// - `ctx`: Contexto de autenticación con `base_url`, `user_id` y `api_key`.
/// - `list_cursor`: Cursor de paginación de la llamada anterior, o `None` para
///   la primera página.
///
/// # Returns
/// [`SteamSeedBatchesResponse`] con las claves de la página y el cursor siguiente.
///
/// # Errors
/// Devuelve `Err(String)` si la petición falla o la API responde con error HTTP.
async fn list_batch_page(
    ctx: &ApiContext,
    list_cursor: Option<&str>,
) -> Result<SteamSeedBatchesResponse, String> {
    let path = match list_cursor {
        Some(c) => format!(
            "/steam-seed/batches?maxKeys=200&cursor={}",
            urlencoding::encode(c)
        ),
        None => "/steam-seed/batches?maxKeys=200".to_string(),
    };

    let list_res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "GET",
        &path,
        None,
    )
    .await
    .map_err(|e| format!("steam-seed/batches: {}", e))?;

    if !list_res.status().is_success() {
        return Err(format!(
            "API steam-seed/batches: {} {}",
            list_res.status(),
            list_res.text().await.unwrap_or_default()
        ));
    }
    list_res.json().await.map_err(|e| e.to_string())
}

/// Recopila claves de batch en orden lexicográfico ascendente desde el cursor actual.
///
/// Solo incluye claves estrictamente mayores que `last_key` y detiene la
/// paginación en cuanto se alcanza `max_batches`.
///
/// # Parameters
/// - `ctx`: Contexto de autenticación.
/// - `last_key`: Última clave ya procesada (exclusiva), o `None` para iniciar
///   desde el principio.
/// - `max_batches`: Límite máximo de claves a devolver.
///
/// # Returns
/// `Vec<String>` con las claves seleccionadas, en orden ascendente.
///
/// # Errors
/// Propaga errores de [`list_batch_page`].
async fn collect_cursor_keys(
    ctx: &ApiContext,
    last_key: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut collected = Vec::with_capacity(max_batches as usize);
    let mut list_cursor: Option<String> = None;

    'pages: loop {
        let page = list_batch_page(ctx, list_cursor.as_deref()).await?;
        for k in page.keys {
            if last_key.map_or(false, |lk| k.as_str() <= lk) {
                continue;
            }
            collected.push(k);
            if collected.len() as u32 >= max_batches {
                break 'pages;
            }
        }
        match page.next_cursor {
            Some(c) => list_cursor = Some(c),
            None => break,
        }
    }
    Ok(collected)
}

/// Obtiene la lista completa de claves de batch disponibles en la nube.
///
/// Pagina hasta agotar todos los resultados; no aplica ningún filtro.
///
/// # Parameters
/// - `ctx`: Contexto de autenticación.
///
/// # Returns
/// `Vec<String>` con todas las claves, en el orden devuelto por la API.
///
/// # Errors
/// Propaga errores de [`list_batch_page`].
async fn fetch_all_batch_keys(ctx: &ApiContext) -> Result<Vec<String>, String> {
    let mut all = Vec::new();
    let mut list_cursor: Option<String> = None;
    loop {
        let page = list_batch_page(ctx, list_cursor.as_deref()).await?;
        all.extend(page.keys);
        match page.next_cursor {
            Some(c) => list_cursor = Some(c),
            None => break,
        }
    }
    Ok(all)
}

/// Recopila claves de batch priorizando las más recientes.
///
/// Ordena descendentemente por clave (sufijo numérico con padding →
/// orden lexicográfico = cronológico), descarta las anteriores al watermark y
/// trunca al límite indicado.
///
/// # Parameters
/// - `ctx`: Contexto de autenticación.
/// - `watermark`: Clave mínima ya procesada (exclusiva), o `None` para incluir
///   todas las disponibles.
/// - `max_batches`: Número máximo de claves a devolver.
///
/// # Returns
/// `Vec<String>` con hasta `max_batches` claves en orden descendente.
///
/// # Errors
/// Propaga errores de [`fetch_all_batch_keys`].
async fn collect_newest_first_keys(
    ctx: &ApiContext,
    watermark: Option<&str>,
    max_batches: u32,
) -> Result<Vec<String>, String> {
    let mut all = fetch_all_batch_keys(ctx).await?;
    // Orden lexicográfico descendente (más reciente primero).
    all.sort_unstable_by(|a, b| b.cmp(a));
    if let Some(w) = watermark {
        all.retain(|k| k.as_str() < w);
    }
    all.truncate(max_batches as usize);
    Ok(all)
}

/// Resuelve las URLs de descarga pre-firmadas para un conjunto de claves en una
/// sola llamada al API (bulk), evitando N round-trips seriales.
///
/// # Parameters
/// - `ctx`: Contexto de autenticación.
/// - `keys`: Slice de claves S3 para las que se solicitan URLs.
///
/// # Returns
/// `HashMap<String, String>` de `key → download_url` para las claves con éxito;
/// las que la API reportó como error quedan excluidas silenciosamente.
///
/// # Errors
/// Devuelve `Err(String)` si la petición HTTP falla o la API responde con error.
async fn resolve_batch_download_urls(
    ctx: &ApiContext,
    keys: &[String],
) -> Result<std::collections::HashMap<String, String>, String> {
    if keys.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let body = serde_json::json!({ "keys": keys }).to_string();
    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/steam-seed/batch/download-url",
        Some(body.as_bytes()),
    )
    .await
    .map_err(|e| format!("steam-seed/batch/download-url (bulk): {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "API steam-seed/batch/download-url (bulk): {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }

    let bulk: SteamSeedBatchDownloadUrlsResponse = res.json().await.map_err(|e| e.to_string())?;

    Ok(bulk
        .results
        .into_iter()
        .filter_map(|r| r.url.map(|u| (r.key, u)))
        .collect())
}

/// Descarga y parsea el contenido JSONL de un batch desde su URL pre-firmada.
///
/// Solo retiene las líneas donde `steam_success == true` y `data` no es nulo.
///
/// # Parameters
/// - `key`: Clave S3 del batch (usada solo en mensajes de error).
/// - `download_url`: URL pre-firmada de descarga.
///
/// # Returns
/// `Vec<(app_id, details_json)>` con las entradas válidas del batch.
///
/// # Errors
/// Devuelve `Err(String)` si la descarga HTTP falla o alguna línea JSONL no se
/// puede deserializar.
async fn fetch_one_batch_from_url(
    key: &str,
    download_url: &str,
) -> Result<Vec<(u32, String)>, String> {
    let content = API_CLIENT
        .get(download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !content.status().is_success() {
        return Err(format!("batch GET {}: {}", key, content.status()));
    }

    let text = content.text().await.map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parsed: SteamSeedBatchLine =
            serde_json::from_str(line).map_err(|e| format!("batch line parse error: {}", e))?;
        if parsed.steam_success == Some(true) {
            if let Some(data) = parsed.data {
                let json = serde_json::to_string(&data).map_err(|e| e.to_string())?;
                out.push((parsed.app_id, json));
            }
        }
    }
    Ok(out)
}

/// Descarga múltiples batches en paralelo con un límite de concurrencia.
///
/// Flujo optimizado en 2 fases:
/// 1. Una sola llamada al API para resolver todas las URLs pre-firmadas (bulk).
/// 2. Descarga concurrente de los contenidos con `buffer_unordered`.
///
/// Comparado con el flujo secuencial original (2 round-trips por batch),
/// la latencia baja de O(n) a O(1 + n/concurrency).
///
/// # Parameters
/// - `ctx`: Contexto de autenticación.
/// - `keys`: Claves S3 a descargar.
/// - `concurrency`: Número máximo de descargas simultáneas.
///
/// # Returns
/// `Vec<(app_id, details_json)>` con todas las entradas de todos los batches.
///
/// # Errors
/// Devuelve `Err(String)` en el primer fallo de resolución o descarga.
async fn fetch_batches_concurrent(
    ctx: &ApiContext,
    keys: &[String],
    concurrency: usize,
) -> Result<Vec<(u32, String)>, String> {
    let url_map = resolve_batch_download_urls(ctx, keys).await?;

    let fetch_tasks: Vec<(String, String)> = keys
        .iter()
        .filter_map(|key| url_map.get(key).map(|url| (key.clone(), url.clone())))
        .collect();

    let results: Vec<Result<Vec<(u32, String)>, String>> = stream::iter(
        fetch_tasks
            .into_iter()
            .map(|(key, url)| async move { fetch_one_batch_from_url(&key, &url).await }),
    )
    .buffer_unordered(concurrency)
    .collect()
    .await;

    let mut updates = Vec::new();
    for r in results {
        updates.extend(r?);
    }
    Ok(updates)
}

/// Descarga `priority_appids.jsonl` desde la nube y reemplaza
/// `steam_catalog_trending` en SQLite con los IDs recibidos.
///
/// Opera en modo "mejor esfuerzo": si el archivo no existe o la API falla,
/// devuelve `Ok(0)` sin propagar el error, preservando el último trending
/// persistido.
///
/// # Parameters
/// - `db`: Handle de la base de datos de la aplicación.
/// - `ctx`: Contexto de autenticación de la API.
///
/// # Returns
/// Número de IDs de tendencia importados (0 si el archivo no existe o hubo error).
///
/// # Errors
/// Solo propaga errores críticos de red o de escritura en SQLite; los errores
/// de "archivo no encontrado" se absorben devolviendo `Ok(0)`.
pub async fn sync_apply_cloud_priority_trending(
    db: &AppDb,
    ctx: &ApiContext,
) -> Result<usize, String> {
    let url_res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/steam-seed/priority/download-url",
        None,
    )
    .await
    .map_err(|e| e.to_string())?;

    if !url_res.status().is_success() {
        return Ok(0);
    }

    let dl: SteamSeedPriorityDownloadUrlResponse =
        url_res.json().await.map_err(|e| e.to_string())?;

    let content = API_CLIENT
        .get(&dl.download_url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !content.status().is_success() {
        return Ok(0);
    }

    let text = content.text().await.map_err(|e| e.to_string())?;
    let ids: Vec<u32> = text
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .filter(|&id| id > 0)
        .collect();

    if ids.is_empty() {
        return Ok(0);
    }

    let n = ids.len();
    let db_clone = db.clone();

    tokio::task::spawn_blocking(move || {
        db_clone.with_conn(|c| {
            replace_trending_app_ids(c, &ids)?;
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: SqliteError| e.to_string())?;

    Ok(n)
}

/// Exporta el manifest de apps locales y las tendencias de tienda a S3 vía API.
///
/// Flujo:
/// 1. Sincroniza tendencias de la Store Steam (mejor esfuerzo).
/// 2. Sube el catálogo completo en partes de `part_size` IDs cada una.
/// 3. Sube los IDs de tendencia como `priority_appids`.
///
/// # Parameters
/// - `db`: Handle de la base de datos.
/// - `part_size`: Tamaño de cada parte del manifest (1–100 000; defecto 50 000).
///
/// # Returns
/// [`SteamSeedExportResultDto`] con el conteo de IDs exportados, partes subidas
/// e IDs de prioridad subidos.
///
/// # Errors
/// Devuelve `Err(String)` ante cualquier fallo de red o de la API.
#[tauri::command]
pub async fn sync_export_steam_manifest_to_cloud_seed(
    db: State<'_, AppDb>,
    part_size: Option<u32>,
) -> Result<SteamSeedExportResultDto, String> {
    let ctx = resolve_api_context()?;
    let db_ref = db.inner().clone();

    // Mejor esfuerzo: fallo aquí no bloquea la exportación.
    let _ = sync_store_trending(&db_ref).await;

    let db_manifest = db.inner().clone();
    let app_ids =
        tokio::task::spawn_blocking(move || db_manifest.with_conn(list_all_catalog_app_ids))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e: SqliteError| e.to_string())?;

    if app_ids.is_empty() {
        return Ok(SteamSeedExportResultDto {
            app_ids_exported: 0,
            parts_uploaded: 0,
            priority_ids_uploaded: 0,
        });
    }

    let size = part_size.unwrap_or(50_000).clamp(1, 100_000) as usize;
    let mut parts_uploaded: u32 = 0;

    for (part_index, chunk) in app_ids.chunks(size).enumerate() {
        let body = serde_json::json!({ "partIndex": part_index as u32 }).to_string();
        let res = api_request(
            &ctx.base_url,
            &ctx.user_id,
            &ctx.api_key,
            "POST",
            "/steam-seed/manifest/upload-url",
            Some(body.as_bytes()),
        )
        .await
        .map_err(|e| format!("manifest/upload-url: {}", e))?;

        if !res.status().is_success() {
            return Err(format!(
                "API steam-seed manifest upload-url: {} {}",
                res.status(),
                res.text().await.unwrap_or_default()
            ));
        }

        let upload: SteamSeedUploadUrlResponse = res.json().await.map_err(|e| e.to_string())?;
        let mut payload = chunk
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        payload.push('\n');

        let put = API_CLIENT
            .put(&upload.upload_url)
            .header("Content-Type", "text/plain; charset=utf-8")
            .body(payload)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        if !put.status().is_success() {
            return Err(format!(
                "S3 PUT manifest part {}: {} {}",
                part_index,
                put.status(),
                put.text().await.unwrap_or_default()
            ));
        }
        parts_uploaded += 1;
    }

    let db_trending = db.inner().clone();
    let trending_ids =
        tokio::task::spawn_blocking(move || db_trending.with_conn(list_trending_app_ids))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e: SqliteError| e.to_string())?;

    let priority_url_res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/steam-seed/priority/upload-url",
        None,
    )
    .await
    .map_err(|e| format!("priority/upload-url: {}", e))?;

    if !priority_url_res.status().is_success() {
        return Err(format!(
            "API steam-seed priority upload-url: {} {}",
            priority_url_res.status(),
            priority_url_res.text().await.unwrap_or_default()
        ));
    }

    let priority_upload: SteamSeedUploadUrlResponse =
        priority_url_res.json().await.map_err(|e| e.to_string())?;

    let priority_payload = if trending_ids.is_empty() {
        String::new()
    } else {
        let mut s = trending_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join("\n");
        s.push('\n');
        s
    };

    let put_priority = API_CLIENT
        .put(&priority_upload.upload_url)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(priority_payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !put_priority.status().is_success() {
        return Err(format!(
            "S3 PUT priority appids: {} {}",
            put_priority.status(),
            put_priority.text().await.unwrap_or_default()
        ));
    }

    Ok(SteamSeedExportResultDto {
        app_ids_exported: app_ids.len() as u32,
        parts_uploaded,
        priority_ids_uploaded: trending_ids.len() as u32,
    })
}

/// Resetea el estado del seed en la nube llamando al endpoint `/steam-seed/reset`.
///
/// # Errors
/// Devuelve `Err(String)` si la llamada HTTP falla o la API responde con un
/// código distinto de 2xx/204.
#[tauri::command]
pub async fn sync_reset_cloud_seed_state() -> Result<(), String> {
    let ctx = resolve_api_context()?;
    let res = api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "POST",
        "/steam-seed/reset",
        None,
    )
    .await
    .map_err(|e| format!("steam-seed/reset: {}", e))?;

    if !res.status().is_success() && res.status().as_u16() != 204 {
        return Err(format!(
            "API steam-seed/reset: {} {}",
            res.status(),
            res.text().await.unwrap_or_default()
        ));
    }
    Ok(())
}

/// Ejecuta una única ronda de importación de batches del seed en la nube.
///
/// Carga el estado previo, descarga hasta `max_batches` batches nuevos según
/// la estrategia indicada, los aplica a SQLite y persiste el estado actualizado.
///
/// # Parameters
/// - `db`: Handle de la base de datos.
/// - `ctx`: Contexto de autenticación.
/// - `max_batches`: Máximo de batches a procesar en esta ronda.
/// - `requested_strategy`: `"cursor"` (ascendente desde el último procesado) o
///   `"newest_first"` (descendente desde el más reciente).
/// - `concurrency`: Número máximo de descargas en paralelo.
///
/// # Returns
/// [`SteamSeedImportResultDto`] con el conteo de batches procesados y filas
/// actualizadas en esta ronda. Devuelve ceros si no hay batches nuevos.
///
/// # Errors
/// Propaga cualquier error de la API o de SQLite.
async fn import_cloud_seed_one_round(
    db: &AppDb,
    ctx: &ApiContext,
    max_batches: u32,
    requested_strategy: &str,
    concurrency: usize,
) -> Result<SteamSeedImportResultDto, String> {
    let db_load = db.clone();
    let mut import_state =
        tokio::task::spawn_blocking(move || db_load.with_conn(load_or_init_import_state))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e: SqliteError| e.to_string())?;

    // Resetear cursores si la estrategia cambió desde la última ronda.
    if import_state.strategy != requested_strategy {
        import_state.cursor_last_key = None;
        import_state.newest_watermark = None;
        import_state.max_imported_batch_key = None;
    }

    let to_process = match requested_strategy {
        "cursor" => {
            collect_cursor_keys(ctx, import_state.cursor_last_key.as_deref(), max_batches).await?
        }
        "newest_first" => {
            collect_newest_first_keys(ctx, import_state.newest_watermark.as_deref(), max_batches)
                .await?
        }
        _ => return Err("estrategia de import no soportada".to_string()),
    };

    if to_process.is_empty() {
        return Ok(SteamSeedImportResultDto {
            batches_processed: 0,
            rows_updated: 0,
        });
    }

    let updates = fetch_batches_concurrent(ctx, &to_process, concurrency).await?;

    // Avanzar cursor/watermark según la estrategia.
    match requested_strategy {
        "cursor" => {
            import_state.cursor_last_key = to_process.iter().max().cloned();
        }
        "newest_first" => {
            import_state.newest_watermark = to_process.iter().min().cloned();
        }
        _ => {}
    }
    import_state.strategy = requested_strategy.to_string();

    // Mantener el high-watermark global del máximo batch importado.
    let batch_max = to_process
        .iter()
        .max()
        .cloned()
        .expect("to_process no vacío");
    import_state.max_imported_batch_key = Some(match import_state.max_imported_batch_key.take() {
        None => batch_max,
        Some(prev) if batch_max > prev => batch_max,
        Some(prev) => prev,
    });

    let db_update = db.clone();
    let rows_updated = tokio::task::spawn_blocking(move || {
        db_update.with_conn(|conn| {
            let n = apply_seed_updates(conn, &updates)?;
            save_import_state(conn, &import_state)?;
            Ok(n)
        })
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e: SqliteError| e.to_string())?;

    Ok(SteamSeedImportResultDto {
        batches_processed: to_process.len() as u32,
        rows_updated,
    })
}

/// Importa una ronda de batches del seed en la nube hacia SQLite.
///
/// Versión de un solo disparo de [`sync_import_cloud_seed_run_until_done`]:
/// procesa exactamente una ronda y devuelve el resultado sin bucle.
///
/// # Parameters
/// - `db`: Handle de la base de datos.
/// - `max_batches`: Máximo de batches a procesar (1–500; defecto 50).
/// - `strategy`: `"cursor"` (defecto) o `"newest_first"`.
/// - `concurrency`: Descargas en paralelo (1–32; defecto 4).
///
/// # Returns
/// [`SteamSeedImportResultDto`] con el resultado de la ronda.
///
/// # Errors
/// Devuelve `Err(String)` ante fallos de red o SQLite.
#[tauri::command]
pub async fn sync_import_cloud_seed_batches_to_sqlite(
    db: State<'_, AppDb>,
    max_batches: Option<u32>,
    strategy: Option<String>,
    concurrency: Option<u32>,
) -> Result<SteamSeedImportResultDto, String> {
    let ctx = resolve_api_context()?;
    let max_batches = max_batches.unwrap_or(50).clamp(1, 500);
    let concurrency = concurrency.unwrap_or(4).clamp(1, 32) as usize;
    let requested_strategy = parse_import_strategy(strategy.as_deref())?;

    import_cloud_seed_one_round(
        db.inner(),
        &ctx,
        max_batches,
        &requested_strategy,
        concurrency,
    )
    .await
}

/// Importa batches del seed en la nube de forma continua hasta agotar todos los disponibles.
///
/// Emite eventos `"steam-seed-import-progress"` en cada ronda para que el
/// frontend pueda mostrar progreso en tiempo real. Al finalizar emite un evento
/// final con `done: true` y aplica el trending de prioridad.
///
/// Tiene un límite de [`STEAM_SEED_IMPORT_MAX_ROUNDS`] rondas para prevenir
/// bucles infinitos ante respuestas anómalas de la API.
///
/// # Parameters
/// - `app`: Handle de la aplicación Tauri (usado para emitir eventos).
/// - `db`: Handle de la base de datos.
/// - `max_batches`: Batches por ronda (1–500; defecto 50).
/// - `strategy`: `"cursor"` (defecto) o `"newest_first"`.
/// - `concurrency`: Descargas en paralelo por ronda (1–32; defecto 4).
///
/// # Returns
/// [`SteamSeedImportRunResultDto`] con totales acumulados de rondas, batches,
/// filas actualizadas e IDs de trending aplicados.
///
/// # Errors
/// Devuelve `Err(String)` si se supera el límite de rondas o ante fallos
/// de red o SQLite en cualquier ronda.
#[tauri::command]
pub async fn sync_import_cloud_seed_run_until_done(
    app: AppHandle,
    db: State<'_, AppDb>,
    max_batches: Option<u32>,
    strategy: Option<String>,
    concurrency: Option<u32>,
) -> Result<SteamSeedImportRunResultDto, String> {
    let ctx = resolve_api_context()?;
    let max_batches = max_batches.unwrap_or(50).clamp(1, 500);
    let concurrency = concurrency.unwrap_or(4).clamp(1, 32) as usize;
    let requested_strategy = parse_import_strategy(strategy.as_deref())?;

    let mut total_batches = 0u32;
    let mut total_rows = 0u32;
    let mut round = 0u32;

    loop {
        round += 1;
        if round > STEAM_SEED_IMPORT_MAX_ROUNDS {
            return Err(
                "Se alcanzó el límite de repeticiones del proceso de descarga. Prueba de nuevo más tarde."
                    .to_string(),
            );
        }

        let r = import_cloud_seed_one_round(
            db.inner(),
            &ctx,
            max_batches,
            &requested_strategy,
            concurrency,
        )
        .await?;

        total_batches = total_batches.saturating_add(r.batches_processed);
        total_rows = total_rows.saturating_add(r.rows_updated);

        let _ = app.emit(
            "steam-seed-import-progress",
            SteamSeedImportProgressPayload {
                iteration: round,
                batches_this_round: r.batches_processed,
                rows_this_round: r.rows_updated,
                total_batches,
                total_rows_updated: total_rows,
                done: false,
            },
        );

        if r.batches_processed == 0 {
            break;
        }
    }

    let _ = app.emit(
        "steam-seed-import-progress",
        SteamSeedImportProgressPayload {
            iteration: round,
            batches_this_round: 0,
            rows_this_round: 0,
            total_batches,
            total_rows_updated: total_rows,
            done: true,
        },
    );

    let trending_priority_entries = sync_apply_cloud_priority_trending(db.inner(), &ctx)
        .await
        .unwrap_or(0);

    Ok(SteamSeedImportRunResultDto {
        rounds: round,
        batches_processed: total_batches,
        rows_updated: total_rows,
        trending_priority_entries: trending_priority_entries as u32,
    })
}

/// Consulta el estado de frescura del seed local versus la nube.
///
/// Usa [`resolve_api_context`] e incluye `x-cloud-host-user-id` cuando hay
/// nube compartida activa, por lo que los invitados ven el estado del anfitrión.
/// La comparación local solo aplica cuando el prefijo `steam-seed/{owner}`
/// coincide entre la respuesta remota y la clave local (evita mezclar scopes).
///
/// # Parameters
/// - `db`: Handle de la base de datos.
///
/// # Returns
/// [`SteamSeedFreshnessDto`] con el estado (`"up_to_date"`, `"stale"`,
/// `"no_local_import"`, `"no_cloud_batches"` o `"unknown"`), las claves de
/// referencia y, en caso de error, su descripción en `error`.
///
/// # Errors
/// Esta función no propaga errores: los encapsula en el campo `error` del DTO
/// y devuelve `status = "unknown"` para que el frontend lo maneje.
#[tauri::command]
pub async fn sync_get_steam_seed_freshness(
    db: State<'_, AppDb>,
) -> Result<SteamSeedFreshnessDto, String> {
    let ctx = match resolve_api_context() {
        Ok(c) => c,
        Err(e) => {
            return Ok(SteamSeedFreshnessDto {
                status: "unknown".to_string(),
                cloud_last_batch_key: None,
                local_max_batch_key: None,
                error: Some(e),
            });
        }
    };

    let db_load = db.inner().clone();
    let local_max = match tokio::task::spawn_blocking(move || {
        db_load.with_conn(|conn| {
            let s = load_or_init_import_state(conn)?;
            Ok::<_, rusqlite::Error>(effective_local_max_imported(&s))
        })
    })
    .await
    {
        Ok(Ok(max)) => max,
        Ok(Err(e)) => {
            return Ok(SteamSeedFreshnessDto {
                status: "unknown".to_string(),
                cloud_last_batch_key: None,
                local_max_batch_key: None,
                error: Some(e.to_string()),
            })
        }
        Err(e) => {
            return Ok(SteamSeedFreshnessDto {
                status: "unknown".to_string(),
                cloud_last_batch_key: None,
                local_max_batch_key: None,
                error: Some(e.to_string()),
            })
        }
    };

    let list_res = match api_request(
        &ctx.base_url,
        &ctx.user_id,
        &ctx.api_key,
        "GET",
        "/steam-seed/status",
        None,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return Ok(SteamSeedFreshnessDto {
                status: "unknown".to_string(),
                cloud_last_batch_key: None,
                local_max_batch_key: local_max,
                error: Some(e),
            });
        }
    };

    if !list_res.status().is_success() {
        let status = list_res.status();
        let body = list_res.text().await.unwrap_or_default();
        return Ok(SteamSeedFreshnessDto {
            status: "unknown".to_string(),
            cloud_last_batch_key: None,
            local_max_batch_key: local_max,
            error: Some(format!("steam-seed/status: {} {}", status, body)),
        });
    }

    let remote: SteamSeedRemoteStatusDto = match list_res.json().await {
        Ok(x) => x,
        Err(e) => {
            return Ok(SteamSeedFreshnessDto {
                status: "unknown".to_string(),
                cloud_last_batch_key: None,
                local_max_batch_key: local_max,
                error: Some(e.to_string()),
            });
        }
    };

    let cloud_last = remote.last_batch_key;
    let local_for_compare =
        local_max_if_same_scope_as_cloud(cloud_last.as_deref(), local_max.as_deref());
    let status =
        compute_steam_seed_freshness_status(cloud_last.as_deref(), local_for_compare).to_string();

    Ok(SteamSeedFreshnessDto {
        status,
        cloud_last_batch_key: cloud_last,
        local_max_batch_key: local_max,
        error: None,
    })
}

#[cfg(test)]
mod freshness_tests {
    use super::{compute_steam_seed_freshness_status, local_max_if_same_scope_as_cloud};

    #[test]
    fn scope_mismatch_ignores_local_max() {
        let cloud = Some("steam-seed/hostOwner/batches/00000002.jsonl");
        let local_other = Some("steam-seed/selfUser/batches/00000099.jsonl");
        assert_eq!(local_max_if_same_scope_as_cloud(cloud, local_other), None);
        assert_eq!(
            compute_steam_seed_freshness_status(
                cloud,
                local_max_if_same_scope_as_cloud(cloud, local_other)
            ),
            "no_local_import"
        );
    }

    #[test]
    fn same_scope_compares_lex() {
        let cloud = "steam-seed/hostOwner/batches/00000002.jsonl";
        let local = "steam-seed/hostOwner/batches/00000001.jsonl";
        assert_eq!(
            local_max_if_same_scope_as_cloud(Some(cloud), Some(local)),
            Some(local)
        );
        assert_eq!(
            compute_steam_seed_freshness_status(
                Some(cloud),
                local_max_if_same_scope_as_cloud(Some(cloud), Some(local))
            ),
            "stale"
        );
    }

    #[test]
    fn lex_order_detects_stale() {
        let k_old = "steam-seed/u/batches/00000001.jsonl";
        let k_new = "steam-seed/u/batches/00000002.jsonl";
        assert_eq!(
            compute_steam_seed_freshness_status(Some(k_new), Some(k_old)),
            "stale"
        );
        assert_eq!(
            compute_steam_seed_freshness_status(Some(k_old), Some(k_new)),
            "up_to_date"
        );
        assert_eq!(
            compute_steam_seed_freshness_status(Some(k_old), Some(k_old)),
            "up_to_date"
        );
    }

    #[test]
    fn no_cloud_no_local_variants() {
        assert_eq!(
            compute_steam_seed_freshness_status(None, Some("x")),
            "no_cloud_batches"
        );
        assert_eq!(
            compute_steam_seed_freshness_status(Some("steam-seed/u/batches/00000001.jsonl"), None),
            "no_local_import"
        );
    }
}
