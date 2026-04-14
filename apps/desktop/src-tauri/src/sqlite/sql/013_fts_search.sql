-- Tabla virtual de búsqueda rápida
CREATE VIRTUAL TABLE IF NOT EXISTS steam_catalog_search USING fts5(
    name_normalized,
    app_id UNINDEXED
);

-- Poblar la tabla de búsqueda con los juegos existentes
INSERT INTO steam_catalog_search (app_id, name_normalized)
SELECT app_id, name_normalized FROM steam_catalog_apps
WHERE name_normalized IS NOT NULL;

-- Trigger para mantenerla actualizada automáticamente
CREATE TRIGGER IF NOT EXISTS trg_catalog_search_insert AFTER INSERT ON steam_catalog_apps BEGIN
    INSERT INTO steam_catalog_search (app_id, name_normalized) VALUES (new.app_id, new.name_normalized);
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_search_update AFTER UPDATE OF name_normalized ON steam_catalog_apps BEGIN
    DELETE FROM steam_catalog_search WHERE app_id = old.app_id;
    INSERT INTO steam_catalog_search (app_id, name_normalized) VALUES (new.app_id, new.name_normalized);
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_search_delete AFTER DELETE ON steam_catalog_apps BEGIN
    DELETE FROM steam_catalog_search WHERE app_id = old.app_id;
END;