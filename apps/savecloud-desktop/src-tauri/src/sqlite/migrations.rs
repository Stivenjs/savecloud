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

    Ok(())
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
        assert_eq!(version, 10);
    }
}
