-- Migración 027: Corrección de deduplicación de facetas y eliminación de índices redundantes.
-- Corrige la regresión introducida en la migración 026 donde los triggers de facetas
-- perdieron el GROUP BY COLLATE NOCASE y se recrearon índices redundantes sobre (app_id, label)
-- que ya están cubiertos por la PRIMARY KEY (app_id, label).

-- 1. Eliminar los índices redundantes sobre (app_id, label) que causan conflictos con la PRIMARY KEY
DROP INDEX IF EXISTS idx_steam_app_genres_appid_label;
DROP INDEX IF EXISTS idx_steam_app_tags_appid_label;

-- 2. Limpieza de posibles duplicados existentes antes de reinstalar triggers
DELETE FROM steam_app_genres
WHERE rowid NOT IN (
    SELECT MIN(rowid)
    FROM steam_app_genres
    GROUP BY app_id, label COLLATE NOCASE
);

DELETE FROM steam_app_tags
WHERE rowid NOT IN (
    SELECT MIN(rowid)
    FROM steam_app_tags
    GROUP BY app_id, label COLLATE NOCASE
);

-- 3. Reinstalar los triggers con deduplicación por GROUP BY COLLATE NOCASE
DROP TRIGGER IF EXISTS trg_insert_facets;
DROP TRIGGER IF EXISTS trg_update_facets;

CREATE TRIGGER trg_insert_facets
AFTER INSERT ON steam_catalog_apps
WHEN NEW.details_json IS NOT NULL AND length(trim(NEW.details_json)) > 0
BEGIN
    INSERT OR IGNORE INTO steam_app_genres (app_id, label)
    SELECT NEW.app_id,
           CASE WHEN json_valid(g.value) AND json_type(g.value) = 'object'
                THEN COALESCE(NULLIF(json_extract(g.value, '$.description'), ''), g.value)
                ELSE g.value END AS genre_label
    FROM json_each(
        CASE WHEN json_valid(NEW.details_json)
               AND json_type(json_extract(NEW.details_json, '$.genres')) = 'array'
             THEN json_extract(NEW.details_json, '$.genres')
             ELSE '[]' END
    ) AS g
    WHERE genre_label IS NOT NULL AND trim(genre_label) != ''
    GROUP BY genre_label COLLATE NOCASE;

    INSERT OR IGNORE INTO steam_app_tags (app_id, label)
    SELECT NEW.app_id,
           CASE WHEN json_valid(t.value) AND json_type(t.value) = 'object'
                THEN COALESCE(NULLIF(json_extract(t.value, '$.description'), ''), t.value)
                ELSE t.value END AS tag_label
    FROM json_each(
        CASE WHEN json_valid(NEW.details_json)
               AND json_type(json_extract(NEW.details_json, '$.categories')) = 'array'
             THEN json_extract(NEW.details_json, '$.categories')
             ELSE '[]' END
    ) AS t
    WHERE tag_label IS NOT NULL AND trim(tag_label) != ''
    GROUP BY tag_label COLLATE NOCASE;
END;

CREATE TRIGGER trg_update_facets
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
                ELSE g.value END AS genre_label
    FROM json_each(
        CASE WHEN json_valid(NEW.details_json)
               AND json_type(json_extract(NEW.details_json, '$.genres')) = 'array'
             THEN json_extract(NEW.details_json, '$.genres')
             ELSE '[]' END
    ) AS g
    WHERE genre_label IS NOT NULL AND trim(genre_label) != ''
    GROUP BY genre_label COLLATE NOCASE;

    INSERT OR IGNORE INTO steam_app_tags (app_id, label)
    SELECT NEW.app_id,
           CASE WHEN json_valid(t.value) AND json_type(t.value) = 'object'
                THEN COALESCE(NULLIF(json_extract(t.value, '$.description'), ''), t.value)
                ELSE t.value END AS tag_label
    FROM json_each(
        CASE WHEN json_valid(NEW.details_json)
               AND json_type(json_extract(NEW.details_json, '$.categories')) = 'array'
             THEN json_extract(NEW.details_json, '$.categories')
             ELSE '[]' END
    ) AS t
    WHERE tag_label IS NOT NULL AND trim(tag_label) != ''
    GROUP BY tag_label COLLATE NOCASE;
END;
