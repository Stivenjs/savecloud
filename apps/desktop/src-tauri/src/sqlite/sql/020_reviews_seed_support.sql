-- Soporte de reviews Steam en catálogo local
ALTER TABLE steam_catalog_apps ADD COLUMN reviews_summary_json TEXT;
ALTER TABLE steam_catalog_apps ADD COLUMN reviews_updated_at INTEGER;

-- Estado local del import de batches de reviews (separado del import de details).
CREATE TABLE IF NOT EXISTS steam_seed_reviews_import_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    strategy TEXT NOT NULL DEFAULT 'cursor',
    cursor_last_key TEXT,
    newest_watermark TEXT,
    max_imported_batch_key TEXT,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT OR IGNORE INTO steam_seed_reviews_import_state (id) VALUES (1);
