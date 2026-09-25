-- Caché persistente de `SteamAppdetailsMedia` (portada, capturas, vídeo, géneros) por app_id.
-- Evita repetir llamadas a la Store cuando ya se consultó un juego (429).
CREATE TABLE IF NOT EXISTS steam_appdetails_media_cache (
    app_id INTEGER PRIMARY KEY NOT NULL CHECK (app_id > 0),
    media_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_steam_appdetails_media_cache_updated ON steam_appdetails_media_cache (updated_at);
