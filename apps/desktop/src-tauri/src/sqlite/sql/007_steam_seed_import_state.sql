-- Estado local del import de batches steam-seed (cursor S3 / prioridad recientes).
CREATE TABLE IF NOT EXISTS steam_seed_import_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    strategy TEXT NOT NULL DEFAULT 'cursor',
    cursor_last_key TEXT,
    newest_watermark TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO steam_seed_import_state (id) VALUES (1);
