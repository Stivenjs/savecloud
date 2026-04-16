use super::types::SteamSeedImportState;
use crate::steam_catalog::normalize::normalize_catalog_name;
use rusqlite::Connection;

/// Lee todos los `app_id` del catálogo Steam en orden ascendente.
pub fn list_all_catalog_app_ids(conn: &Connection) -> Result<Vec<u32>, rusqlite::Error> {
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
pub fn list_trending_app_ids(conn: &Connection) -> Result<Vec<u32>, rusqlite::Error> {
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
pub fn load_or_init_import_state(
    conn: &Connection,
) -> Result<SteamSeedImportState, rusqlite::Error> {
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
pub fn save_import_state(
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
pub fn apply_seed_updates(
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
#[inline]
pub fn infer_name_from_details_json(details_json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(details_json).ok()?;
    let name = v.get("name")?.as_str()?.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}
