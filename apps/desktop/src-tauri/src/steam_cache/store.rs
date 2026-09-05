//! Almacén concurrente y acotado para respuestas de la API de Steam.

use std::sync::{LazyLock, OnceLock};

use moka::sync::Cache;

use crate::sqlite::AppDb;
use crate::steam_cache::key::is_valid_steam_app_id;
use crate::steam_cache::types::{
    normalize_steam_app_details, normalize_steam_appdetails_media, SteamAppDetails,
    SteamAppdetailsMedia,
};

/// Capacidad por defecto: equilibrio entre memoria y aciertos en bibliotecas medianas.
const MEDIA_CACHE_CAPACITY: u64 = 4096;
const DETAILS_CACHE_CAPACITY: u64 = 2048;

static INSTANCE: LazyLock<SteamApiCache> = LazyLock::new(SteamApiCache::new);
static SQLITE_DB: OnceLock<AppDb> = OnceLock::new();

/// Vincula la base de datos local SQLite para persistencia offline-first de medios.
pub fn init_steam_cache_db(db: AppDb) {
    let _ = SQLITE_DB.set(db);
}

/// Acceso global al caché de metadatos Steam (un proceso, una instancia).
#[must_use]
pub fn steam_api_cache() -> &'static SteamApiCache {
    &INSTANCE
}

/// Caché thread-safe en dos niveles: memoria RAM ([`moka::sync::Cache`]) y persistente en disco ([`AppDb`]).
///
/// Permite un arranque instantáneo offline-first sin peticiones de red redundantes a Steam.
pub struct SteamApiCache {
    media: Cache<String, SteamAppdetailsMedia>,
    details: Cache<String, SteamAppDetails>,
}

impl SteamApiCache {
    fn new() -> Self {
        Self {
            media: Cache::builder().max_capacity(MEDIA_CACHE_CAPACITY).build(),
            details: Cache::builder()
                .max_capacity(DETAILS_CACHE_CAPACITY)
                .build(),
        }
    }

    #[must_use]
    pub fn get_media(&self, app_id: &str) -> Option<SteamAppdetailsMedia> {
        if let Some(cached) = self.media.get(app_id) {
            return Some(cached);
        }

        // Si no está en RAM, consultar la base de datos local SQLite
        if let Some(db) = SQLITE_DB.get() {
            if let Ok(pid) = app_id.trim().parse::<i64>() {
                let db_res = db.with_conn(|conn| {
                    let mut stmt = conn.prepare_cached(
                        "SELECT media_json FROM steam_appdetails_media_cache WHERE app_id = ?1",
                    )?;
                    let json: Result<String, _> = stmt.query_row([pid], |row| row.get(0));
                    Ok(json.ok())
                });

                if let Ok(Some(json)) = db_res {
                    if let Ok(media) = serde_json::from_str::<SteamAppdetailsMedia>(&json) {
                        let normalized = normalize_steam_appdetails_media(media);
                        self.media.insert(app_id.to_string(), normalized.clone());
                        return Some(normalized);
                    }
                }
            }
        }

        None
    }

    /// Inserta medios en RAM y persiste en SQLite (cache-aside offline-first).
    pub fn insert_media(&self, app_id: String, value: SteamAppdetailsMedia) {
        if !is_valid_steam_app_id(&app_id) {
            return;
        }
        let normalized = normalize_steam_appdetails_media(value);
        self.media.insert(app_id.clone(), normalized.clone());

        if let Some(db) = SQLITE_DB.get() {
            if let Ok(pid) = app_id.trim().parse::<i64>() {
                if let Ok(json) = serde_json::to_string(&normalized) {
                    let db = db.clone();
                    let _ = db.with_conn(move |conn| {
                        conn.execute(
                            "INSERT INTO steam_appdetails_media_cache (app_id, media_json, updated_at) \
                             VALUES (?1, ?2, unixepoch()) \
                             ON CONFLICT(app_id) DO UPDATE SET \
                             media_json = excluded.media_json, updated_at = unixepoch()",
                            rusqlite::params![pid, json],
                        )?;
                        Ok(())
                    });
                }
            }
        }
    }

    #[must_use]
    pub fn get_details(&self, app_id: &str) -> Option<SteamAppDetails> {
        self.details.get(app_id)
    }

    pub fn insert_details(&self, app_id: String, value: SteamAppDetails) {
        if !is_valid_steam_app_id(&app_id) {
            return;
        }
        self.details
            .insert(app_id, normalize_steam_app_details(value));
    }

    /// Descarta los metadatos y medios cacheados en memoria y en SQLite para un juego.
    pub fn invalidate(&self, app_id: &str) {
        self.media.invalidate(app_id);
        self.details.invalidate(app_id);

        if let Some(db) = SQLITE_DB.get() {
            if let Ok(pid) = app_id.trim().parse::<i64>() {
                let db = db.clone();
                let _ = db.with_conn(move |conn| {
                    conn.execute(
                        "DELETE FROM steam_appdetails_media_cache WHERE app_id = ?1",
                        [pid],
                    )?;
                    Ok(())
                });
            }
        }
    }
}
