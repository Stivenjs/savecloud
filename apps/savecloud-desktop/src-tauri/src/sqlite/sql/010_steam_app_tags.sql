-- Etiquetas (categorías) de los juegos en el catálogo Steam.
CREATE TABLE IF NOT EXISTS steam_app_tags (
    app_id INTEGER NOT NULL,
    label TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (app_id, label)
);
CREATE INDEX IF NOT EXISTS idx_steam_app_tags_label ON steam_app_tags(label);