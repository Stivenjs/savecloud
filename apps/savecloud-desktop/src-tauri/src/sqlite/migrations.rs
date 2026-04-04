//! Migraciones incrementales usando `PRAGMA user_version`.

use rusqlite::Connection;

/// Arreglo con todos los scripts de migración en orden.
/// El índice del arreglo corresponde a la versión:
/// MIGRATIONS[0] actualiza de la versión 0 a la 1.
/// MIGRATIONS[1] actualiza de la versión 1 a la 2, etc.
const MIGRATIONS: &[&str] = &[
    include_str!("sql/001_catalog_init.sql"),
    include_str!("sql/002_catalog_sync_meta.sql"),
    include_str!("sql/003_catalog_details_json.sql"),
    include_str!("sql/004_catalog_trending.sql"),
    include_str!("sql/005_steam_media_cache.sql"),
    include_str!("sql/006_notifications.sql"),
    include_str!("sql/007_steam_seed_import_state.sql"),
    include_str!("sql/008_steam_seed_max_imported.sql"),
    "", // 9
    concat!(
        include_str!("sql/009_steam_app_genres.sql"),
        ";\n",
        include_str!("sql/010_steam_app_tags.sql")
    ), // 10
    include_str!("sql/011_fill_facets_and_triggers.sql"),
    include_str!("sql/012_fast_sort_index.sql"),
    include_str!("sql/013_fts_search.sql"),
    include_str!("sql/014_covering_indexes.sql"),
    include_str!("sql/015_fix_fts_triggers.sql"),
    include_str!("sql/016_seed_patch.sql"),
];

/// Aplica migraciones pendientes de forma idempotente.
pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    let current_version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    for (index, sql) in MIGRATIONS.iter().enumerate() {
        let target_version = (index + 1) as i32;

        if current_version < target_version {
            let tx = conn.unchecked_transaction()?;

            if !sql.trim().is_empty() {
                tx.execute_batch(sql)?;
            }

            tx.pragma_update(None, "user_version", target_version)?;
            tx.commit()?;
        }
    }

    // Backfill de catalog_rank_score para apps que ya tenían details_json
    // antes de la migración 016. Se ejecuta en cada arranque pero es un no-op
    // si el metadato rank_score_backfill ya está escrito.
    //
    // Colocarlo aquí —y no solo en run_catalog_sync— garantiza que el catálogo
    // sea navegable inmediatamente después de instalar el update, sin que el
    // usuario tenga que ejecutar un sync primero.
    run_rank_score_backfill_if_needed(conn);

    Ok(())
}

/// Recalcula `catalog_rank_score` para todas las apps con `details_json`, una sola vez.
///
/// Usa el metadato [`META_RANK_SCORE_BACKFILL`] como flag persistente: una vez escrito,
/// el backfill nunca vuelve a correr en arranques posteriores, incluso si hay apps con
/// `score = 0` (esas apps tienen JSON sin datos útiles y 0 es su score correcto).
///
/// Si la fórmula de scoring cambia en el futuro, incrementar [`RANK_SCORE_BACKFILL_VERSION`]
/// para forzar un recálculo global en el próximo arranque.
fn run_rank_score_backfill_if_needed(conn: &Connection) {
    use crate::steam_catalog::meta::{
        get_meta, set_meta, META_RANK_SCORE_BACKFILL, RANK_SCORE_BACKFILL_VERSION,
    };

    // Si el metadato ya existe con la versión actual, el backfill ya corrió: salir inmediatamente.
    let already_done = get_meta(conn, META_RANK_SCORE_BACKFILL)
        .ok()
        .flatten()
        .as_deref()
        == Some(RANK_SCORE_BACKFILL_VERSION);

    if already_done {
        return;
    }

    // Primera ejecución tras la migración 016 (o tras un bump de versión de scoring).
    match crate::steam_catalog::scoring::backfill_rank_scores(conn) {
        Ok(updated) => {
            eprintln!(
                "[migrations] Backfill catalog_rank_score completado: {updated} scores calculados."
            );
            // Marcar como hecho para que nunca vuelva a correr.
            if let Err(e) = set_meta(conn, META_RANK_SCORE_BACKFILL, RANK_SCORE_BACKFILL_VERSION) {
                eprintln!("[migrations] No se pudo guardar el metadato de backfill: {e}");
            }
        }
        Err(e) => {
            // No abortar el arranque; el catálogo funciona con scores en 0 (orden degradado).
            eprintln!("[migrations] Error en backfill de scores (no fatal): {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::run_migrations;
    use rusqlite::Connection;

    #[test]
    fn migrations_run_twice_without_error() {
        let conn = Connection::open_in_memory().expect("in memory");
        run_migrations(&conn).expect("first");
        run_migrations(&conn).expect("second");

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 16);
    }
}
