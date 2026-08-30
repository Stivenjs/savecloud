-- Migración 023: Tablas virtuales FTS5 con tokenizador de trigramas para búsqueda rápida de subcadenas

-- 1. Tabla de búsqueda por trigramas para catálogo de Steam
CREATE VIRTUAL TABLE IF NOT EXISTS steam_catalog_trigram USING fts5(
    name_normalized,
    app_id UNINDEXED,
    tokenize='trigram'
);

-- Poblar la tabla de trigramas de Steam con los datos existentes
INSERT INTO steam_catalog_trigram (app_id, name_normalized)
SELECT app_id, name_normalized FROM steam_catalog_apps
WHERE name_normalized IS NOT NULL;

-- Triggers de sincronización automática para steam_catalog_trigram
CREATE TRIGGER IF NOT EXISTS trg_catalog_trigram_insert
AFTER INSERT ON steam_catalog_apps
WHEN NEW.name_normalized IS NOT NULL
BEGIN
    INSERT INTO steam_catalog_trigram (app_id, name_normalized)
    VALUES (NEW.app_id, NEW.name_normalized);
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_trigram_update
AFTER UPDATE OF name_normalized ON steam_catalog_apps
WHEN NEW.name_normalized IS NOT NULL
  AND (OLD.name_normalized IS NULL OR OLD.name_normalized != NEW.name_normalized)
BEGIN
    DELETE FROM steam_catalog_trigram WHERE app_id = OLD.app_id;
    INSERT INTO steam_catalog_trigram (app_id, name_normalized)
    VALUES (NEW.app_id, NEW.name_normalized);
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_trigram_delete
AFTER DELETE ON steam_catalog_apps
BEGIN
    DELETE FROM steam_catalog_trigram WHERE app_id = OLD.app_id;
END;


-- 2. Tabla de búsqueda por trigramas para items de fuentes de descargas
CREATE VIRTUAL TABLE IF NOT EXISTS source_items_trigram USING fts5(
    normalized_title,
    source_id UNINDEXED,
    item_id UNINDEXED,
    tokenize='trigram'
);

-- Poblar la tabla de trigramas de fuentes con los items existentes
INSERT INTO source_items_trigram (source_id, item_id, normalized_title)
SELECT source_id, item_id, normalized_title FROM source_items
WHERE normalized_title IS NOT NULL;

-- Triggers de sincronización automática para source_items_trigram
CREATE TRIGGER IF NOT EXISTS trg_source_items_trigram_insert
AFTER INSERT ON source_items
BEGIN
    INSERT INTO source_items_trigram (source_id, item_id, normalized_title)
    VALUES (NEW.source_id, NEW.item_id, NEW.normalized_title);
END;

CREATE TRIGGER IF NOT EXISTS trg_source_items_trigram_update
AFTER UPDATE OF normalized_title ON source_items
BEGIN
    DELETE FROM source_items_trigram WHERE source_id = OLD.source_id AND item_id = OLD.item_id;
    INSERT INTO source_items_trigram (source_id, item_id, normalized_title)
    VALUES (NEW.source_id, NEW.item_id, NEW.normalized_title);
END;

CREATE TRIGGER IF NOT EXISTS trg_source_items_trigram_delete
AFTER DELETE ON source_items
BEGIN
    DELETE FROM source_items_trigram WHERE source_id = OLD.source_id AND item_id = OLD.item_id;
END;
