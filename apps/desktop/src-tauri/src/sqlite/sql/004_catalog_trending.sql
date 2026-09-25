-- Ranking de “tendencia” desde la Store (featuredcategories: top sellers, ofertas, novedades).
CREATE TABLE IF NOT EXISTS steam_catalog_trending (
    app_id INTEGER PRIMARY KEY NOT NULL CHECK (app_id > 0),
    rank INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_steam_catalog_trending_rank ON steam_catalog_trending (rank);
