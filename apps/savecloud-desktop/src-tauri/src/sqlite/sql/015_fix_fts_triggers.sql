DROP TRIGGER IF EXISTS trg_catalog_search_insert;
DROP TRIGGER IF EXISTS trg_catalog_search_update;
DROP TRIGGER IF EXISTS trg_catalog_search_delete;

-- Solo inserta en FTS si name_normalized está presente.
CREATE TRIGGER IF NOT EXISTS trg_catalog_search_insert
AFTER INSERT ON steam_catalog_apps
WHEN NEW.name_normalized IS NOT NULL
BEGIN
    INSERT INTO steam_catalog_search (app_id, name_normalized)
    VALUES (NEW.app_id, NEW.name_normalized);
END;

-- Solo actúa si name_normalized cambió de valor efectivamente.
CREATE TRIGGER IF NOT EXISTS trg_catalog_search_update
AFTER UPDATE OF name_normalized ON steam_catalog_apps
WHEN NEW.name_normalized IS NOT NULL
  AND (OLD.name_normalized IS NULL OR OLD.name_normalized != NEW.name_normalized)
BEGIN
    DELETE FROM steam_catalog_search WHERE app_id = OLD.app_id;
    INSERT INTO steam_catalog_search (app_id, name_normalized)
    VALUES (NEW.app_id, NEW.name_normalized);
END;

CREATE TRIGGER IF NOT EXISTS trg_catalog_search_delete
AFTER DELETE ON steam_catalog_apps
BEGIN
    DELETE FROM steam_catalog_search WHERE app_id = OLD.app_id;
END;