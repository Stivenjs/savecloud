-- Catálogo Steam: filas sembradas desde IStoreService/GetAppList y enriquecidas con appdetails.
-- name_normalized: búsqueda sin depender de collation Unicode completa (se rellena al insertar).
CREATE TABLE IF NOT EXISTS steam_catalog_apps (
    app_id INTEGER PRIMARY KEY NOT NULL CHECK (app_id > 0),
    name TEXT NOT NULL,
    name_normalized TEXT,
    enriched_at INTEGER,
    last_sync_batch_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_steam_catalog_apps_name_norm ON steam_catalog_apps (name_normalized);
