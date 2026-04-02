-- Índices compuestos (Covering Indexes) para acelerar el filtrado por etiquetas y géneros.
CREATE INDEX IF NOT EXISTS idx_steam_app_genres_label_app ON steam_app_genres(label, app_id);
CREATE INDEX IF NOT EXISTS idx_steam_app_tags_label_app ON steam_app_tags(label, app_id);