-- 1. Llenar los datos existentes que ya tenías guardados (Backfill)
INSERT OR IGNORE INTO steam_app_genres (app_id, label)
SELECT 
    a.app_id, 
    CASE 
        WHEN json_valid(g.value) AND json_type(g.value) = 'object' THEN COALESCE(NULLIF(json_extract(g.value, '$.description'), ''), g.value) 
        ELSE g.value 
    END
FROM steam_catalog_apps a, 
     json_each(CASE WHEN json_valid(a.details_json) AND json_type(json_extract(a.details_json, '$.genres')) = 'array' THEN json_extract(a.details_json, '$.genres') ELSE '[]' END) AS g
WHERE a.details_json IS NOT NULL AND length(trim(a.details_json)) > 0;

INSERT OR IGNORE INTO steam_app_tags (app_id, label)
SELECT 
    a.app_id, 
    CASE 
        WHEN json_valid(t.value) AND json_type(t.value) = 'object' THEN COALESCE(NULLIF(json_extract(t.value, '$.description'), ''), t.value) 
        ELSE t.value 
    END
FROM steam_catalog_apps a, 
     json_each(CASE WHEN json_valid(a.details_json) AND json_type(json_extract(a.details_json, '$.categories')) = 'array' THEN json_extract(a.details_json, '$.categories') ELSE '[]' END) AS t
WHERE a.details_json IS NOT NULL AND length(trim(a.details_json)) > 0;

-- 2. Crear Triggers (Para que se llenen automáticamente con los juegos futuros)
CREATE TRIGGER IF NOT EXISTS trg_insert_facets
AFTER INSERT ON steam_catalog_apps
WHEN NEW.details_json IS NOT NULL AND length(trim(NEW.details_json)) > 0
BEGIN
    INSERT OR IGNORE INTO steam_app_genres (app_id, label)
    SELECT NEW.app_id, CASE WHEN json_valid(g.value) AND json_type(g.value) = 'object' THEN COALESCE(NULLIF(json_extract(g.value, '$.description'), ''), g.value) ELSE g.value END
    FROM json_each(CASE WHEN json_valid(NEW.details_json) AND json_type(json_extract(NEW.details_json, '$.genres')) = 'array' THEN json_extract(NEW.details_json, '$.genres') ELSE '[]' END) AS g;

    INSERT OR IGNORE INTO steam_app_tags (app_id, label)
    SELECT NEW.app_id, CASE WHEN json_valid(t.value) AND json_type(t.value) = 'object' THEN COALESCE(NULLIF(json_extract(t.value, '$.description'), ''), t.value) ELSE t.value END
    FROM json_each(CASE WHEN json_valid(NEW.details_json) AND json_type(json_extract(NEW.details_json, '$.categories')) = 'array' THEN json_extract(NEW.details_json, '$.categories') ELSE '[]' END) AS t;
END;

CREATE TRIGGER IF NOT EXISTS trg_update_facets
AFTER UPDATE OF details_json ON steam_catalog_apps
WHEN NEW.details_json IS NOT NULL AND length(trim(NEW.details_json)) > 0
BEGIN
    DELETE FROM steam_app_genres WHERE app_id = NEW.app_id;
    DELETE FROM steam_app_tags WHERE app_id = NEW.app_id;

    INSERT OR IGNORE INTO steam_app_genres (app_id, label)
    SELECT NEW.app_id, CASE WHEN json_valid(g.value) AND json_type(g.value) = 'object' THEN COALESCE(NULLIF(json_extract(g.value, '$.description'), ''), g.value) ELSE g.value END
    FROM json_each(CASE WHEN json_valid(NEW.details_json) AND json_type(json_extract(NEW.details_json, '$.genres')) = 'array' THEN json_extract(NEW.details_json, '$.genres') ELSE '[]' END) AS g;

    INSERT OR IGNORE INTO steam_app_tags (app_id, label)
    SELECT NEW.app_id, CASE WHEN json_valid(t.value) AND json_type(t.value) = 'object' THEN COALESCE(NULLIF(json_extract(t.value, '$.description'), ''), t.value) ELSE t.value END
    FROM json_each(CASE WHEN json_valid(NEW.details_json) AND json_type(json_extract(NEW.details_json, '$.categories')) = 'array' THEN json_extract(NEW.details_json, '$.categories') ELSE '[]' END) AS t;
END;