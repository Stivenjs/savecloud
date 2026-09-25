-- Reemplazamos el índice anterior por este que cubre EXACTAMENTE nuestro ORDER BY.
-- Al no tener JOINs, SQLite puede usar este índice para paginar instantáneamente.
DROP INDEX IF EXISTS idx_catalog_pagination;

CREATE INDEX IF NOT EXISTS idx_catalog_fast_sort 
ON steam_catalog_apps(
    (details_json IS NOT NULL) DESC, 
    enriched_at DESC, 
    last_sync_batch_at DESC, 
    app_id DESC
);