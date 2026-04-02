-- Índice acelera la ordenación por defecto cuando el usuario abre el catálogo
CREATE INDEX IF NOT EXISTS idx_catalog_pagination 
ON steam_catalog_apps(last_sync_batch_at DESC, app_id DESC);