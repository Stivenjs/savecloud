//! Claves en `catalog_sync_meta` para reanudación e incrementales.

use rusqlite::{Connection, OptionalExtension};

/// `1` cuando al menos una pasada completa por `GetAppList` terminó con `have_more == false`.
pub const META_FULL_SYNC_DONE: &str = "full_sync_done";
/// Último `last_appid` enviado a Steam en un sync completo interrumpido (reanudación).
pub const META_RESUME_LAST_APPID: &str = "resume_last_appid";
/// Epoch Unix (segundos) de la última sincronización exitosa (full o incremental) para `if_modified_since`.
pub const META_LAST_INCREMENTAL_AT: &str = "last_incremental_sync_at";
/// Hash de los flags `include_*` de `GetAppList` usados en el último sync completo; si cambia el código, hay que reindexar.
pub const META_APP_LIST_SCOPE: &str = "app_list_scope";
/// Epoch Unix cuando terminó el último **sync completo** (todas las páginas). Sirve para forzar un rescaneo cada N días.
pub const META_FULL_CATALOG_COMPLETED_AT: &str = "full_catalog_completed_at_unix";
/// Versión de la lógica de paginación (`have_more` + lote lleno); si cambia, se fuerza sync completo otra vez.
pub const META_CATALOG_SYNC_LOGIC_VERSION: &str = "catalog_sync_logic_version";
/// Valor de [`set_meta`] cuando el backfill de `name_normalized` (lógica v2) ya se aplicó; ver [`crate::steam_catalog::normalize`].
pub const META_NAME_NORMALIZED_BACKFILL: &str = "name_normalized_backfill";

/// Valor de [`set_meta`] cuando el backfill de `catalog_rank_score` (scoring v1) ya se aplicó.
/// Una vez escrito, el backfill nunca vuelve a correr aunque haya apps con score = 0
/// (esas apps tienen JSON sin datos útiles y su score es 0 de forma permanente).
pub const META_RANK_SCORE_BACKFILL: &str = "rank_score_backfill";
/// Versión actual del backfill de scoring; incrementar si cambia la fórmula de scoring
/// para forzar un recálculo global en el próximo arranque.
pub const RANK_SCORE_BACKFILL_VERSION: &str = "0.1.3";

pub fn get_meta(conn: &Connection, key: &str) -> Result<Option<String>, rusqlite::Error> {
    conn.query_row(
        "SELECT value FROM catalog_sync_meta WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
}

pub fn set_meta(conn: &Connection, key: &str, value: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO catalog_sync_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )?;
    Ok(())
}

pub fn delete_meta(conn: &Connection, key: &str) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM catalog_sync_meta WHERE key = ?1", [key])?;
    Ok(())
}
