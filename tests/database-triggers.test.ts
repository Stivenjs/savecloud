/**
 * @fileoverview Pruebas automatizadas de sincronización mediante triggers SQL en tablas virtuales FTS5.
 *
 * Valida que los triggers `AFTER INSERT`, `AFTER UPDATE` y `AFTER DELETE` mantengan la coherencia
 * entre las tablas relacionales (`steam_catalog_apps`, `source_items`) y sus correspondientes
 * tablas virtuales FTS5 (`steam_catalog_trigram`, `source_items_trigram`) sin requerir re-indexación manual.
 *
 * @module tests/database-triggers.test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

interface TrigramMatchRow {
  readonly app_id: number;
}

interface SourceTrigramMatchRow {
  readonly source_id: string;
  readonly item_id: string;
}

function resolveDatabasePath(): string {
  if (process.env.SAVECLOUD_DB_PATH) {
    return process.env.SAVECLOUD_DB_PATH;
  }

  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWindows) {
    const appData = process.env.APPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Roaming");
    return path.join(appData, "SaveCloud", "data", "db", "catalog.sqlite");
  }

  if (isMac) {
    const home = process.env.HOME || "";
    return path.join(home, "Library", "Application Support", "SaveCloud", "data", "db", "catalog.sqlite");
  }

  const home = process.env.HOME || "";
  const configHome = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(configHome, "SaveCloud", "data", "db", "catalog.sqlite");
}

describe("Triggers y Sincronizacion FTS5", () => {
  let db: Database;
  const testAppId = 999999991;
  const testSourceId = "test-trigger-source";
  const testItemId = "test-trigger-item-01";

  beforeAll(() => {
    const dbPath = resolveDatabasePath();
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Base de datos no encontrada en: ${dbPath}`);
    }
    db = new Database(dbPath);

    // Limpieza inicial preventiva
    db.query("DELETE FROM steam_catalog_apps WHERE app_id = ?").run(testAppId);
    db.query("DELETE FROM source_items WHERE source_id = ? AND item_id = ?").run(testSourceId, testItemId);
    db.query("DELETE FROM sources WHERE id = ?").run(testSourceId);
  });

  afterAll(() => {
    db.query("DELETE FROM steam_catalog_apps WHERE app_id = ?").run(testAppId);
    db.query("DELETE FROM source_items WHERE source_id = ? AND item_id = ?").run(testSourceId, testItemId);
    db.query("DELETE FROM sources WHERE id = ?").run(testSourceId);
    db.close();
  });

  describe("Triggers en steam_catalog_apps -> steam_catalog_trigram", () => {
    it("debe insertar automaticamente en steam_catalog_trigram al crear una app", () => {
      db.query(
        `INSERT INTO steam_catalog_apps (app_id, name, name_normalized, catalog_rank_score)
         VALUES (?, 'Test Trigger Game Alpha', 'test trigger game alpha', 100000)`
      ).run(testAppId);

      const matches = db
        .query("SELECT app_id FROM steam_catalog_trigram WHERE steam_catalog_trigram MATCH '\"trigger game\"'")
        .all() as TrigramMatchRow[];

      expect(matches.some((m) => m.app_id === testAppId)).toBe(true);
    });

    it("debe actualizar steam_catalog_trigram cuando cambia name_normalized", () => {
      db.query(
        `UPDATE steam_catalog_apps 
         SET name = 'Test Trigger Game Omega', name_normalized = 'test trigger game omega' 
         WHERE app_id = ?`
      ).run(testAppId);

      const oldMatches = db
        .query("SELECT app_id FROM steam_catalog_trigram WHERE steam_catalog_trigram MATCH '\"alpha\"'")
        .all() as TrigramMatchRow[];
      expect(oldMatches.some((m) => m.app_id === testAppId)).toBe(false);

      const newMatches = db
        .query("SELECT app_id FROM steam_catalog_trigram WHERE steam_catalog_trigram MATCH '\"omega\"'")
        .all() as TrigramMatchRow[];
      expect(newMatches.some((m) => m.app_id === testAppId)).toBe(true);
    });

    it("debe eliminar de steam_catalog_trigram al borrar una app", () => {
      db.query("DELETE FROM steam_catalog_apps WHERE app_id = ?").run(testAppId);

      const matches = db
        .query("SELECT app_id FROM steam_catalog_trigram WHERE steam_catalog_trigram MATCH '\"trigger game\"'")
        .all() as TrigramMatchRow[];

      expect(matches.some((m) => m.app_id === testAppId)).toBe(false);
    });
  });

  describe("Triggers en source_items -> source_items_trigram", () => {
    it("debe insertar automaticamente en source_items_trigram al crear un item", () => {
      db.query(`INSERT INTO sources (id, name, imported_at) VALUES (?, 'Test Trigger Source', datetime('now'))`).run(
        testSourceId
      );

      db.query(
        `INSERT INTO source_items (source_id, item_id, title, normalized_title, uris_json)
         VALUES (?, ?, 'Cybernetic Odyssey Repack v1.0', 'cybernetic odyssey repack v1 0', '["https://example.com/item"]')`
      ).run(testSourceId, testItemId);

      const matches = db
        .query(
          "SELECT source_id, item_id FROM source_items_trigram WHERE source_items_trigram MATCH '\"cybernetic odyssey\"'"
        )
        .all() as SourceTrigramMatchRow[];

      expect(matches.some((m) => m.source_id === testSourceId && m.item_id === testItemId)).toBe(true);
    });

    it("debe actualizar source_items_trigram al modificar normalized_title", () => {
      db.query(
        `UPDATE source_items 
         SET title = 'Galactic Odyssey Repack v2.0', normalized_title = 'galactic odyssey repack v2 0'
         WHERE source_id = ? AND item_id = ?`
      ).run(testSourceId, testItemId);

      const oldMatches = db
        .query("SELECT source_id, item_id FROM source_items_trigram WHERE source_items_trigram MATCH '\"cybernetic\"'")
        .all() as SourceTrigramMatchRow[];
      expect(oldMatches.some((m) => m.source_id === testSourceId && m.item_id === testItemId)).toBe(false);

      const newMatches = db
        .query(
          "SELECT source_id, item_id FROM source_items_trigram WHERE source_items_trigram MATCH '\"galactic odyssey\"'"
        )
        .all() as SourceTrigramMatchRow[];
      expect(newMatches.some((m) => m.source_id === testSourceId && m.item_id === testItemId)).toBe(true);
    });

    it("debe eliminar de source_items_trigram al borrar el item", () => {
      db.query("DELETE FROM source_items WHERE source_id = ? AND item_id = ?").run(testSourceId, testItemId);

      const matches = db
        .query(
          "SELECT source_id, item_id FROM source_items_trigram WHERE source_items_trigram MATCH '\"galactic odyssey\"'"
        )
        .all() as SourceTrigramMatchRow[];

      expect(matches.some((m) => m.source_id === testSourceId && m.item_id === testItemId)).toBe(false);
    });
  });
});
