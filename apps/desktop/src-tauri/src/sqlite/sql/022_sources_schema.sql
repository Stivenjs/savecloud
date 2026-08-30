-- Migración 022: Esquema de persistencia para fuentes y catálogos de descargas
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    source_url TEXT,
    imported_at TEXT NOT NULL,
    etag TEXT,
    last_modified TEXT,
    content_hash TEXT,
    last_checked_at TEXT,
    last_synced_at TEXT,
    sync_error TEXT
);

CREATE TABLE IF NOT EXISTS source_items (
    source_id TEXT NOT NULL,
    item_id TEXT NOT NULL,
    title TEXT NOT NULL,
    normalized_title TEXT NOT NULL,
    upload_date TEXT,
    file_size TEXT,
    uris_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (source_id, item_id),
    FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_source_items_source ON source_items(source_id);
CREATE INDEX IF NOT EXISTS idx_source_items_norm_title ON source_items(normalized_title);
CREATE INDEX IF NOT EXISTS idx_sources_url ON sources(source_url);
