/**
 * @fileoverview Tests current SQLite FTS triggers and migration 024 using an isolated database.
 * @module tests/database-triggers.test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { createSqliteDatabaseFixture } from "./helpers/sqlite-database-fixture";

interface TrigramMatchRow {
  readonly app_id: number;
}

interface SchemaObjectRow {
  readonly name: string;
}

describe("Triggers y Sincronización FTS5", () => {
  let db: Database;
  const testAppId = 999_999_991;

  beforeAll(() => {
    db = createSqliteDatabaseFixture();
  });

  afterAll(() => {
    db.close();
  });

  describe("Triggers en steam_catalog_apps -> steam_catalog_trigram", () => {
    it("debe insertar automáticamente en steam_catalog_trigram al crear una app", () => {
      db.query(
        `INSERT INTO steam_catalog_apps (app_id, name, name_normalized, catalog_rank_score)
         VALUES (?, 'Test Trigger Game Alpha', 'test trigger game alpha', 100000)`
      ).run(testAppId);

      const matches = db
        .query("SELECT app_id FROM steam_catalog_trigram WHERE steam_catalog_trigram MATCH 'alpha'")
        .all() as TrigramMatchRow[];

      expect(matches.some((match) => match.app_id === testAppId)).toBe(true);
    });

    it("debe actualizar steam_catalog_trigram al modificar name_normalized", () => {
      db.query(
        `UPDATE steam_catalog_apps
         SET name = 'Test Trigger Game Omega', name_normalized = 'test trigger game omega'
         WHERE app_id = ?`
      ).run(testAppId);

      const oldMatches = db
        .query("SELECT app_id FROM steam_catalog_trigram WHERE steam_catalog_trigram MATCH 'alpha'")
        .all() as TrigramMatchRow[];
      const newMatches = db
        .query("SELECT app_id FROM steam_catalog_trigram WHERE steam_catalog_trigram MATCH 'omega'")
        .all() as TrigramMatchRow[];

      expect(oldMatches.some((match) => match.app_id === testAppId)).toBe(false);
      expect(newMatches.some((match) => match.app_id === testAppId)).toBe(true);
    });

    it("debe eliminar la app de steam_catalog_trigram al borrar su registro", () => {
      db.query("DELETE FROM steam_catalog_apps WHERE app_id = ?").run(testAppId);

      const matches = db
        .query("SELECT app_id FROM steam_catalog_trigram WHERE steam_catalog_trigram MATCH 'omega'")
        .all() as TrigramMatchRow[];

      expect(matches.some((match) => match.app_id === testAppId)).toBe(false);
    });
  });

  describe("Migración 024 para búsquedas de fuentes", () => {
    it("debe retirar la tabla FTS y sus triggers obsoletos", () => {
      const objects = db
        .query(
          `SELECT name FROM sqlite_master
           WHERE name IN (
             'source_items_trigram',
             'trg_source_items_trigram_insert',
             'trg_source_items_trigram_update',
             'trg_source_items_trigram_delete'
           )`
        )
        .all() as SchemaObjectRow[];

      expect(objects).toHaveLength(0);
    });
  });
});
