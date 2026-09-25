use chrono::Utc;
use rusqlite::{params, OptionalExtension, Row};

use super::models::{ConfiguredGame, GameLibrary};
use crate::sqlite::AppDb;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPage {
    pub games: Vec<ConfiguredGame>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
}

fn db() -> Result<AppDb, String> {
    AppDb::open().map_err(|error| format!("No se pudo abrir la biblioteca SQLite: {error}"))
}

fn profile_id() -> String {
    crate::config::profile_storage::active_profile_id()
}

fn sqlite_error(error: String) -> rusqlite::Error {
    rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(error)))
}

fn ensure_legacy_migration(conn: &rusqlite::Connection, profile: &str) -> Result<(), String> {
    let migrated: Option<String> = conn
        .query_row(
            "SELECT migrated_at FROM library_legacy_migrations WHERE profile_id = ?1",
            params![profile],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if migrated.is_some() {
        return Ok(());
    }

    let Some(path) = crate::config::profile_storage::scoped_or_legacy_path(
        crate::config::paths::LIBRARY_FILE_NAME,
    ) else {
        return Err("No se pudo resolver library.json".to_string());
    };

    let games = if path.exists() {
        let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
        let library: GameLibrary = serde_json::from_slice(&bytes)
            .map_err(|error| format!("No se pudo parsear library.json: {error}"))?;
        library.games
    } else {
        Vec::new()
    };

    let tx = conn.unchecked_transaction().map_err(|error| error.to_string())?;
    for game in &games {
        upsert_game_in_tx(&tx, profile, game).map_err(|error| error.to_string())?;
    }
    tx.execute(
        "INSERT INTO library_legacy_migrations (profile_id, migrated_at) VALUES (?1, ?2)",
        params![profile, Utc::now().to_rfc3339()],
    )
    .map_err(|error| error.to_string())?;
    tx.commit().map_err(|error| error.to_string())?;

    let migrated_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM library_games WHERE profile_id = ?1",
            params![profile],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if migrated_count < games.len() as i64 {
        return Err("La migración de library.json no verificó todos los juegos".to_string());
    }

    if path.exists() {
        let backup = path.with_extension("json.sqlite-migrated");
        std::fs::rename(path, backup).map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn upsert_game_in_tx(
    tx: &rusqlite::Transaction<'_>,
    profile: &str,
    game: &ConfiguredGame,
) -> Result<(), rusqlite::Error> {
    let executable_names = game
        .executable_names
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;

    tx.execute(
        "INSERT INTO library_games (
            profile_id, id, steam_app_id, image_url, executable_names_json,
            edition_label, source_url, magnet_link, launch_executable_path, playtime_seconds
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(profile_id, id) DO UPDATE SET
            steam_app_id = excluded.steam_app_id,
            image_url = excluded.image_url,
            executable_names_json = excluded.executable_names_json,
            edition_label = excluded.edition_label,
            source_url = excluded.source_url,
            magnet_link = excluded.magnet_link,
            launch_executable_path = excluded.launch_executable_path,
            playtime_seconds = excluded.playtime_seconds",
        params![
            profile,
            game.id,
            game.steam_app_id,
            game.image_url,
            executable_names,
            game.edition_label,
            game.source_url,
            game.magnet_link,
            game.launch_executable_path,
            game.playtime_seconds as i64,
        ],
    )?;

    tx.execute(
        "DELETE FROM library_game_paths WHERE profile_id = ?1 AND game_id = ?2",
        params![profile, game.id],
    )?;
    for path in &game.paths {
        tx.execute(
            "INSERT OR IGNORE INTO library_game_paths (profile_id, game_id, path) VALUES (?1, ?2, ?3)",
            params![profile, game.id, path],
        )?;
    }
    Ok(())
}

fn map_game(row: &Row<'_>) -> Result<ConfiguredGame, rusqlite::Error> {
    let id: String = row.get(1)?;
    let paths_value: String = row.get(10)?;
    let paths = if paths_value.is_empty() {
        Vec::new()
    } else {
        paths_value.split('\u{1f}').map(str::to_string).collect()
    };
    let executable_names_json: Option<String> = row.get(4)?;
    let executable_names = executable_names_json
        .map(|json| serde_json::from_str(&json).unwrap_or_default());

    let playtime_seconds: i64 = row.get(9)?;
    Ok(ConfiguredGame {
        id,
        paths,
        steam_app_id: row.get(2)?,
        image_url: row.get(3)?,
        executable_names,
        edition_label: row.get(5)?,
        source_url: row.get(6)?,
        magnet_link: row.get(7)?,
        launch_executable_path: row.get(8)?,
        playtime_seconds: playtime_seconds.max(0) as u64,
    })
}

const SELECT_GAME: &str = "SELECT g.profile_id, g.id, g.steam_app_id, g.image_url, g.executable_names_json, g.edition_label, g.source_url, g.magnet_link, g.launch_executable_path, g.playtime_seconds, COALESCE(group_concat(p.path, char(31)), '') FROM library_games g LEFT JOIN library_game_paths p ON p.profile_id = g.profile_id AND p.game_id = g.id";

pub fn page(offset: usize, limit: usize, search: Option<&str>) -> Result<LibraryPage, String> {
    let db = db()?;
    let profile = profile_id();
    db.with_conn(|conn| {
        ensure_legacy_migration(conn, &profile).map_err(sqlite_error)?;
        let pattern = search
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| format!("%{}%", value.to_lowercase()));
        let total: i64 = if let Some(pattern) = &pattern {
            conn.query_row(
                "SELECT COUNT(*) FROM library_games WHERE profile_id = ?1 AND lower(id) LIKE ?2",
                params![profile, pattern],
                |row| row.get(0),
            )?
        } else {
            conn.query_row(
                "SELECT COUNT(*) FROM library_games WHERE profile_id = ?1",
                params![profile],
                |row| row.get(0),
            )?
        };
        let query = if pattern.is_some() {
            format!("{SELECT_GAME} WHERE g.profile_id = ?1 AND lower(g.id) LIKE ?2 GROUP BY g.profile_id, g.id ORDER BY g.id COLLATE NOCASE LIMIT ?3 OFFSET ?4")
        } else {
            format!("{SELECT_GAME} WHERE g.profile_id = ?1 GROUP BY g.profile_id, g.id ORDER BY g.id COLLATE NOCASE LIMIT ?2 OFFSET ?3")
        };
        let mut stmt = conn.prepare(&query)?;
        let mut games = Vec::new();
        if let Some(pattern) = pattern {
            let rows = stmt.query_map(params![profile, pattern, limit as i64, offset as i64], |row| {
                map_game(row)
            })?;
            for game in rows {
                games.push(game?);
            }
        } else {
            let rows = stmt.query_map(params![profile, limit as i64, offset as i64], |row| {
                map_game(row)
            })?;
            for game in rows {
                games.push(game?);
            }
        }
        Ok(LibraryPage {
            games,
            total: total.max(0) as usize,
            offset,
            limit,
        })
    })
    .map_err(|error| error.to_string())
}

pub fn all() -> Result<GameLibrary, String> {
    let page = page(0, i64::MAX as usize, None)?;
    Ok(GameLibrary { games: page.games })
}

pub fn get(game_id: &str) -> Result<Option<ConfiguredGame>, String> {
    let db = db()?;
    let profile = profile_id();
    db.with_conn(|conn| {
        ensure_legacy_migration(conn, &profile).map_err(sqlite_error)?;
        conn.query_row(
            &format!("{SELECT_GAME} WHERE g.profile_id = ?1 AND g.id = ?2 GROUP BY g.profile_id, g.id"),
            params![profile, game_id],
            |row| map_game(row),
        )
        .optional()
    })
    .map_err(|error| error.to_string())
}

pub fn upsert(game: &ConfiguredGame) -> Result<(), String> {
    let db = db()?;
    let profile = profile_id();
    db.with_conn(|conn| {
        ensure_legacy_migration(conn, &profile).map_err(sqlite_error)?;
        let tx = conn.unchecked_transaction()?;
        upsert_game_in_tx(&tx, &profile, game)?;
        tx.commit()
    })
    .map_err(|error| error.to_string())
}

pub fn delete(game_id: &str) -> Result<(), String> {
    let db = db()?;
    let profile = profile_id();
    db.with_conn(|conn| {
        ensure_legacy_migration(conn, &profile).map_err(sqlite_error)?;
        conn.execute(
            "DELETE FROM library_games WHERE profile_id = ?1 AND id = ?2",
            params![profile, game_id],
        )?;
        Ok(())
    })
    .map_err(|error| error.to_string())
}

pub fn add_playtime(game_id: &str, seconds: u64) -> Result<u64, String> {
    let db = db()?;
    let profile = profile_id();
    db.with_conn(|conn| {
        ensure_legacy_migration(conn, &profile).map_err(sqlite_error)?;
        let updated = conn.execute(
            "UPDATE library_games SET playtime_seconds = playtime_seconds + ?1 WHERE profile_id = ?2 AND id = ?3",
            params![seconds as i64, profile, game_id],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        conn.query_row(
            "SELECT COALESCE(SUM(playtime_seconds), 0) FROM library_games WHERE profile_id = ?1",
            params![profile],
            |row| row.get::<_, i64>(0),
        )
    })
    .map(|total| total.max(0) as u64)
    .map_err(|error| error.to_string())
}

pub fn total_playtime() -> Result<u64, String> {
    let db = db()?;
    let profile = profile_id();
    db.with_conn(|conn| {
        ensure_legacy_migration(conn, &profile).map_err(sqlite_error)?;
        conn.query_row(
            "SELECT COALESCE(SUM(playtime_seconds), 0) FROM library_games WHERE profile_id = ?1",
            params![profile],
            |row| row.get::<_, i64>(0),
        )
    })
    .map(|total| total.max(0) as u64)
    .map_err(|error| error.to_string())
}

pub fn replace(library: &GameLibrary) -> Result<(), String> {
    let db = db()?;
    let profile = profile_id();
    db.with_conn(|conn| {
        ensure_legacy_migration(conn, &profile).map_err(sqlite_error)?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "DELETE FROM library_games WHERE profile_id = ?1",
            params![profile],
        )?;
        for game in &library.games {
            upsert_game_in_tx(&tx, &profile, game)?;
        }
        tx.commit()
    })
    .map_err(|error| error.to_string())
}
