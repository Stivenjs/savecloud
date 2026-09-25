ALTER TABLE steam_catalog_apps 
    ADD COLUMN catalog_rank_score INTEGER;

DROP INDEX IF EXISTS idx_catalog_fast_sort;

CREATE INDEX IF NOT EXISTS idx_catalog_rank_sort
    ON steam_catalog_apps (
        catalog_rank_score DESC,
        enriched_at DESC,
        app_id DESC
    );