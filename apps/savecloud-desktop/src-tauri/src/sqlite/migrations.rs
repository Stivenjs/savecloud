//! Migraciones incrementales usando `PRAGMA user_version`.

use rusqlite::Connection;

/// Aplica migraciones pendientes de forma idempotente.
pub fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    let version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if version < 1 {
        conn.execute_batch(include_str!("sql/001_catalog_init.sql"))?;
        conn.pragma_update(None, "user_version", "1")?;
    }

    if version < 2 {
        conn.execute_batch(include_str!("sql/002_catalog_sync_meta.sql"))?;
        conn.pragma_update(None, "user_version", "2")?;
    }

    if version < 3 {
        conn.execute_batch(include_str!("sql/003_catalog_details_json.sql"))?;
        conn.pragma_update(None, "user_version", "3")?;
    }

    if version < 4 {
        conn.execute_batch(include_str!("sql/004_catalog_trending.sql"))?;
        conn.pragma_update(None, "user_version", "4")?;
    }

    if version < 5 {
        conn.execute_batch(include_str!("sql/005_steam_media_cache.sql"))?;
        conn.pragma_update(None, "user_version", "5")?;
    }

    if version < 6 {
        conn.execute_batch(include_str!("sql/006_notifications.sql"))?;
        conn.pragma_update(None, "user_version", "6")?;
    }

    if version < 7 {
        conn.execute_batch(include_str!("sql/007_steam_seed_import_state.sql"))?;
        conn.pragma_update(None, "user_version", "7")?;
    }

    if version < 8 {
        conn.execute_batch(include_str!("sql/008_steam_seed_max_imported.sql"))?;
        conn.pragma_update(None, "user_version", "8")?;
    }

    if version < 9 {
        conn.pragma_update(None, "user_version", "9")?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::run_migrations;

    #[test]
    fn migrations_run_twice_without_error() {
        let conn = Connection::open_in_memory().expect("in memory");
        run_migrations(&conn).expect("first");
        run_migrations(&conn).expect("second");
    }
}
