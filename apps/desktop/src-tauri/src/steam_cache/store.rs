//! Almacén concurrente y acotado para respuestas de la API de Steam.

use std::sync::LazyLock;

use moka::sync::Cache;

use crate::steam_cache::key::is_valid_steam_app_id;
use crate::steam_cache::types::{
    normalize_steam_app_details, normalize_steam_appdetails_media, SteamAppDetails,
    SteamAppdetailsMedia,
};

/// Capacidad por defecto: equilibrio entre memoria y aciertos en bibliotecas medianas.
const MEDIA_CACHE_CAPACITY: u64 = 4096;
const DETAILS_CACHE_CAPACITY: u64 = 2048;

static INSTANCE: LazyLock<SteamApiCache> = LazyLock::new(SteamApiCache::new);

/// Acceso global al caché de metadatos Steam (un proceso, una instancia).
#[must_use]
pub fn steam_api_cache() -> &'static SteamApiCache {
    &INSTANCE
}

/// Caché thread-safe con política LRU aproximada ([`moka::sync::Cache`]).
///
/// No persiste en disco: solo reduce llamadas repetidas a `appdetails` en una sesión.
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
        self.media.get(app_id)
    }

    /// Inserta medios solo si la clave es un App ID válido (evita contaminar el LRU).
    pub fn insert_media(&self, app_id: String, value: SteamAppdetailsMedia) {
        if !is_valid_steam_app_id(&app_id) {
            return;
        }
        self.media
            .insert(app_id, normalize_steam_appdetails_media(value));
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

    /// Descarta los metadatos y medios cacheados en memoria para un juego.
    pub fn invalidate(&self, app_id: &str) {
        self.media.invalidate(app_id);
        self.details.invalidate(app_id);
    }
}
