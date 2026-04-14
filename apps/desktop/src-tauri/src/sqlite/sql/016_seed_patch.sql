CREATE INDEX IF NOT EXISTS idx_steam_app_genres_appid_label
    ON steam_app_genres(app_id, label);

CREATE INDEX IF NOT EXISTS idx_steam_app_tags_appid_label
    ON steam_app_tags(app_id, label);