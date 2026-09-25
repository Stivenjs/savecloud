-- Migracion 026: formaliza las relaciones de facetas con el catalogo Steam.
-- Se reconstruyen las tablas porque SQLite no permite anadir una FK con ALTER TABLE.

DROP TRIGGER IF EXISTS trg_insert_facets;
DROP TRIGGER IF EXISTS trg_update_facets;

CREATE TABLE steam_app_genres_with_fk (
    app_id INTEGER NOT NULL,
    label TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (app_id, label),
    FOREIGN KEY (app_id) REFERENCES steam_catalog_apps(app_id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO steam_app_genres_with_fk (app_id, label)
SELECT g.app_id, g.label
FROM steam_app_genres AS g
JOIN steam_catalog_apps AS a ON a.app_id = g.app_id;

DROP TABLE steam_app_genres;
ALTER TABLE steam_app_genres_with_fk RENAME TO steam_app_genres;
CREATE INDEX idx_steam_app_genres_label ON steam_app_genres(label);
CREATE INDEX idx_steam_app_genres_appid_label ON steam_app_genres(app_id, label);

CREATE TABLE steam_app_tags_with_fk (
    app_id INTEGER NOT NULL,
    label TEXT NOT NULL COLLATE NOCASE,
    PRIMARY KEY (app_id, label),
    FOREIGN KEY (app_id) REFERENCES steam_catalog_apps(app_id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO steam_app_tags_with_fk (app_id, label)
SELECT t.app_id, t.label
FROM steam_app_tags AS t
JOIN steam_catalog_apps AS a ON a.app_id = t.app_id;

DROP TABLE steam_app_tags;
ALTER TABLE steam_app_tags_with_fk RENAME TO steam_app_tags;
CREATE INDEX idx_steam_app_tags_label ON steam_app_tags(label);
CREATE INDEX idx_steam_app_tags_appid_label ON steam_app_tags(app_id, label);

CREATE TRIGGER trg_insert_facets
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

CREATE TRIGGER trg_update_facets
AFTER UPDATE OF details_json ON steam_catalog_apps
WHEN NEW.details_json IS NOT NULL
    AND length(trim(NEW.details_json)) > 0
    AND (OLD.details_json IS NULL OR OLD.details_json != NEW.details_json)
BEGIN
        DELETE FROM steam_app_genres WHERE app_id = NEW.app_id;
        DELETE FROM steam_app_tags WHERE app_id = NEW.app_id;

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