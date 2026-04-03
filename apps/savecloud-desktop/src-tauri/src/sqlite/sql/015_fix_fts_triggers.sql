DROP TRIGGER IF EXISTS trg_insert_facets;
DROP TRIGGER IF EXISTS trg_update_facets;
DROP TRIGGER IF EXISTS trg_catalog_search_insert;
DROP TRIGGER IF EXISTS trg_catalog_search_update;
DROP TRIGGER IF EXISTS trg_catalog_search_delete;

-- Facets en INSERT
CREATE TRIGGER IF NOT EXISTS trg_insert_facets
AFTER INSERT ON steam_catalog_apps
WHEN NEW.details_json IS NOT NULL AND length(trim(NEW.details_json)) > 0
BEGIN
    INSERT OR IGNORE INTO steam_app_genres (app_id, label)
    SELECT NEW.app_id,
           CASE WHEN json_valid(g.value) AND json_type(g.value) = 'object'
                THEN COALESCE(NULLIF(json_extract(g.value, '$.description'), ''), g.value)
                ELSE g.value END
    FROM json_each(
        CASE WHEN json_valid(NEW.details_json)
               AND json_type(json_extract(NEW.details_json, '$.genres')) = 'array'
             THEN json_extract(NEW.details_json, '$.genres')
             ELSE '[]' END
    ) AS g;

    INSERT OR IGNORE INTO steam_app_tags (app_id, label)
    SELECT NEW.app_id,
           CASE WHEN json_valid(t.value) AND json_type(t.value) = 'object'
                THEN COALESCE(NULLIF(json_extract(t.value, '$.description'), ''), t.value)
                ELSE t.value END
    FROM json_each(
        CASE WHEN json_valid(NEW.details_json)
               AND json_type(json_extract(NEW.details_json, '$.categories')) = 'array'
             THEN json_extract(NEW.details_json, '$.categories')
             ELSE '[]' END
    ) AS t;
END;

-- Facets en UPDATE
CREATE TRIGGER IF NOT EXISTS trg_update_facets
AFTER UPDATE OF details_json ON steam_catalog_apps
WHEN NEW.details_json IS NOT NULL
  AND length(trim(NEW.details_json)) > 0
  AND (OLD.details_json IS NULL OR OLD.details_json != NEW.details_json)
BEGIN
    DELETE FROM steam_app_genres WHERE app_id = NEW.app_id;
    DELETE FROM steam_app_tags   WHERE app_id = NEW.app_id;

    INSERT OR IGNORE INTO steam_app_genres (app_id, label)
    SELECT NEW.app_id,
           CASE WHEN json_valid(g.value) AND json_type(g.value) = 'object'
                THEN COALESCE(NULLIF(json_extract(g.value, '$.description'), ''), g.value)
                ELSE g.value END
    FROM json_each(
        CASE WHEN json_valid(NEW.details_json)
               AND json_type(json_extract(NEW.details_json, '$.genres')) = 'array'
             THEN json_extract(NEW.details_json, '$.genres')
             ELSE '[]' END
    ) AS g;

    INSERT OR IGNORE INTO steam_app_tags (app_id, label)
    SELECT NEW.app_id,
           CASE WHEN json_valid(t.value) AND json_type(t.value) = 'object'
                THEN COALESCE(NULLIF(json_extract(t.value, '$.description'), ''), t.value)
                ELSE t.value END
    FROM json_each(
        CASE WHEN json_valid(NEW.details_json)
               AND json_type(json_extract(NEW.details_json, '$.categories')) = 'array'
             THEN json_extract(NEW.details_json, '$.categories')
             ELSE '[]' END
    ) AS t;
END;

-- FTS en INSERT
CREATE TRIGGER IF NOT EXISTS trg_catalog_search_insert
AFTER INSERT ON steam_catalog_apps
WHEN NEW.name_normalized IS NOT NULL
BEGIN
    INSERT INTO steam_catalog_search (app_id, name_normalized)
    VALUES (NEW.app_id, NEW.name_normalized);
END;

-- FTS en UPDATE
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