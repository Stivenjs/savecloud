//! Migraciones incrementales de SQLite usando `PRAGMA user_version`.
//!
//! Este módulo gestiona la evolución del esquema de base de datos de forma
//! determinista e idempotente.
//!
//! # Estrategia
//!
//! - Cada entrada en [`MIGRATIONS`] representa un paso de versión.
//! - El índice del array + 1 = versión objetivo.
//! - Las migraciones se aplican secuencialmente dentro de transacciones.
//! - Se usa `PRAGMA user_version` como fuente de verdad.
//!
//! # Post-migración
//!
//! Se ejecuta un backfill incremental de `catalog_rank_score` para garantizar
//! que el catálogo sea navegable inmediatamente tras una actualización.
//!
//! # Garantías
//!
//! - Idempotente (puede ejecutarse múltiples veces sin efectos secundarios)
//! - Seguro ante fallos (no deja la DB en estado inconsistente)
//! - Escalable (evita full scans innecesarios)

use rusqlite::Connection;

/// Arreglo con todos los scripts de migración en orden.
///
/// # Convención
///
/// - `MIGRATIONS[0]` → versión 1
/// - `MIGRATIONS[1]` → versión 2
/// - etc.
///
/// Cada script debe ser **idempotente** o ejecutarse dentro de una transacción segura.
const MIGRATIONS: &[&str] = &[
    include_str!("sql/001_catalog_init.sql"),
    include_str!("sql/002_catalog_sync_meta.sql"),
    include_str!("sql/003_catalog_details_json.sql"),
    include_str!("sql/004_catalog_trending.sql"),
    include_str!("sql/005_steam_media_cache.sql"),
    include_str!("sql/006_notifications.sql"),
    include_str!("sql/007_steam_seed_import_state.sql"),
    include_str!("sql/008_steam_seed_max_imported.sql"),
    include_str!("sql/009_steam_app_genres.sql"),
    include_str!("sql/010_steam_app_tags.sql"),
    include_str!("sql/011_fill_facets_and_triggers.sql"),
    include_str!("sql/012_fast_sort_index.sql"),
    include_str!("sql/013_fts_search.sql"),
    include_str!("sql/014_covering_indexes.sql"),
    include_str!("sql/015_fix_fts_triggers.sql"),
    include_str!("sql/016_seed_patch.sql"),
    include_str!("sql/017_catalog_rank_score.sql"),
    include_str!("sql/018_fix_corrupted_indexes.sql"),
    include_str!("sql/019_fix_indexes.sql"),
    include_str!("sql/020_reviews_seed_support.sql"),
    include_str!("sql/021_plugin_storage.sql"),
    include_str!("sql/022_sources_schema.sql"),
];

/// Ejecuta todas las migraciones pendientes.
///
/// # Parameters
///
/// - `conn`: Conexión SQLite activa.
///
/// # Returns
///
/// - `Ok(())` si todas las migraciones se aplicaron correctamente.
/// - `Err(rusqlite::Error)` si ocurre algún error SQL.
///
/// # Comportamiento
///
/// - Solo aplica migraciones cuya versión sea mayor a `user_version`.
/// - Cada migración se ejecuta dentro de su propia transacción.
/// - Actualiza `PRAGMA user_version` tras cada paso exitoso.
/// - Ejecuta un backfill incremental de scores al final.
///
/// # Complejidad
///
/// O(n) donde n = número de migraciones pendientes.
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

    // Backfill incremental post-migración
    run_rank_score_backfill_if_needed(conn);

    Ok(())
}

/// Ejecuta un backfill incremental de `catalog_rank_score`.
///
/// # Estrategia
///
/// - Solo recalcula filas donde `catalog_rank_score IS NULL`.
/// - Evita full scan en catálogos grandes.
/// - Idempotente: puede ejecutarse múltiples veces sin efectos secundarios.
///
/// # Versionado
///
/// Controlado por [`META_RANK_SCORE_BACKFILL`].
/// Si cambia la fórmula de scoring, incrementar
/// [`RANK_SCORE_BACKFILL_VERSION`] para forzar recalculo.
///
/// # Performance
///
/// O(k) donde k = filas sin score (no O(n) total).
///
/// # Fault tolerance
///
/// - No bloquea arranque si falla
/// - Permite degradación (score = 0)
///
/// # Parameters
///
/// - `conn`: Conexión SQLite activa.
///
/// # Returns
///
/// No retorna resultado; maneja errores internamente.
fn run_rank_score_backfill_if_needed(conn: &Connection) {
    use crate::steam_catalog::meta::{
        get_meta, set_meta, META_RANK_SCORE_BACKFILL, RANK_SCORE_BACKFILL_VERSION,
    };

    let stored_version = get_meta(conn, META_RANK_SCORE_BACKFILL).ok().flatten();

    let already_done = stored_version.as_deref() == Some(RANK_SCORE_BACKFILL_VERSION);

    if already_done {
        return;
    }

    // Detectar si es primera vez o cambio de versión
    let result = if stored_version.is_none() {
        // Primera vez → solo missing
        crate::steam_catalog::scoring::update_missing_scores(conn)
    } else {
        // Cambio de versión → recalcular TODO
        crate::steam_catalog::scoring::backfill_rank_scores(conn)
    };

    match result {
        Ok(updated) => {
            eprintln!("[migrations] Rank score backfill ejecutado: {updated} filas afectadas.");

            if let Err(e) = set_meta(conn, META_RANK_SCORE_BACKFILL, RANK_SCORE_BACKFILL_VERSION) {
                eprintln!("[migrations] Error guardando metadato: {e}");
            }
        }
        Err(e) => {
            eprintln!("[migrations] Error en backfill (no fatal): {e}");
        }
    }
}
#[cfg(test)]
mod tests {
    use super::run_migrations;
    use rusqlite::Connection;

    /// Verifica que las migraciones son idempotentes.
    ///
    /// # Estrategia
    ///
    /// Ejecuta dos veces `run_migrations` sobre una DB en memoria y valida:
    ///
    /// - No hay errores en la segunda ejecución
    /// - La versión final es consistente
    #[test]
    fn migrations_run_twice_without_error() {
        let conn = Connection::open_in_memory().expect("in memory");

        run_migrations(&conn).expect("first run");
        run_migrations(&conn).expect("second run");

        let version: i32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();

        assert_eq!(version, super::MIGRATIONS.len() as i32);
    }
}
