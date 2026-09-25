-- Migracion 027: biblioteca local paginable por perfil.
CREATE TABLE IF NOT EXISTS library_games (
    profile_id TEXT NOT NULL,
    id TEXT NOT NULL COLLATE NOCASE,
    steam_app_id TEXT,
    image_url TEXT,
    executable_names_json TEXT,
    edition_label TEXT,
    source_url TEXT,
    magnet_link TEXT,
    launch_executable_path TEXT,
    playtime_seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, id)
);

CREATE TABLE IF NOT EXISTS library_game_paths (
    profile_id TEXT NOT NULL,
    game_id TEXT NOT NULL COLLATE NOCASE,
    path TEXT NOT NULL,
    PRIMARY KEY (profile_id, game_id, path),
    FOREIGN KEY (profile_id, game_id)
        REFERENCES library_games(profile_id, id)
        ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS library_legacy_migrations (
    profile_id TEXT PRIMARY KEY NOT NULL,
    migrated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_library_games_profile_id
    ON library_games(profile_id, id COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_library_games_profile_steam
    ON library_games(profile_id, steam_app_id);
CREATE INDEX IF NOT EXISTS idx_library_games_profile_name
    ON library_games(profile_id, id COLLATE NOCASE);