-- Metadatos de sincronización con IStoreService/GetAppList (reanudación e incrementales).
CREATE TABLE IF NOT EXISTS catalog_sync_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
