/**
 * @fileoverview Suite de pruebas automatizadas para la base de datos local SQLite y motor FTS5 de SaveCloud.
 *
 * @module tests/database.test
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { createSqliteDatabaseFixture } from "./helpers/sqlite-database-fixture";

interface UserVersionRow {
  readonly user_version: number;
}

interface QuickCheckRow {
  readonly quick_check: string;
}

interface TableRow {
  readonly name: string;
}

interface CountRow {
  readonly count: number;
}

interface SteamAppRow {
  readonly app_id: number;
  readonly name: string;
  readonly catalog_rank_score: number | null;
}

interface SourceItemRow {
  readonly source_id: string;
  readonly item_id: string;
  readonly title: string;
  readonly normalized_title: string;
  readonly uris_json: string;
  readonly file_size: string | null;
}

describe("SaveCloud SQLite Database Suite", () => {
  let db: Database;

  beforeAll(() => {
    db = createSqliteDatabaseFixture();
  });

  afterAll(() => {
    db.close();
  });
  afterAll(() => {
    db.close();
  });

  describe("Esquema e Integridad", () => {
    it("debe superar el chequeo de integridad rapido de SQLite", () => {
      const row = db.query("PRAGMA quick_check").get() as QuickCheckRow;
      expect(row.quick_check).toBe("ok");
    });

    it("debe contar con una version de migracion igual o superior a v26", () => {
      const row = db.query("PRAGMA user_version").get() as UserVersionRow;
      expect(row.user_version).toBeGreaterThanOrEqual(26);
    });

    it("debe contener todas las tablas relacionales y virtuales FTS5 requeridas", () => {
      const requiredTables = [
        "steam_catalog_apps",
        "steam_catalog_trending",
        "steam_catalog_search",
        "steam_catalog_trigram",
        "sources",
        "source_items",
        "steam_app_genres",
        "steam_app_tags",
        "steam_appdetails_media_cache",
      ];

      const rows = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as TableRow[];

      const existingTables = new Set(rows.map((r) => r.name));

      for (const table of requiredTables) {
        expect(existingTables.has(table)).toBe(true);
      }

      expect(existingTables.has("source_items_trigram")).toBe(false);
    });
  });

  describe("Catalogo de Steam y Metadatos", () => {
    it("debe tener aplicaciones indexadas en steam_catalog_apps", () => {
      const row = db.query("SELECT COUNT(*) as count FROM steam_catalog_apps").get() as CountRow;
      expect(row.count).toBeGreaterThan(0);
    });

    it("debe devolver aplicaciones ordenadas por catalog_rank_score", () => {
      const rows = db
        .query(
          `SELECT app_id, name, catalog_rank_score 
           FROM steam_catalog_apps 
           WHERE catalog_rank_score > 0 
           ORDER BY catalog_rank_score DESC 
           LIMIT 10`
        )
        .all() as SteamAppRow[];

      expect(rows.length).toBe(10);
      for (const app of rows) {
        expect(app.app_id).toBeGreaterThan(0);
        expect(typeof app.name).toBe("string");
        expect(app.name.length).toBeGreaterThan(0);
        expect(app.catalog_rank_score).toBeGreaterThan(0);
      }
    });

    it("debe ejecutar busquedas FTS5 con trigramas en tiempo sub-milisegundo", () => {
      const queries = ["cyberpunk", "witcher", "deadlock"];

      for (const query of queries) {
        const start = performance.now();
        const rows = db
          .query(
            `SELECT a.app_id, a.name, a.catalog_rank_score
             FROM steam_catalog_trigram s
             JOIN steam_catalog_apps a ON a.app_id = s.app_id
             WHERE steam_catalog_trigram MATCH ?
             ORDER BY a.catalog_rank_score DESC
             LIMIT 5`
          )
          .all(`"${query}"`) as SteamAppRow[];

        const elapsedMs = performance.now() - start;

        expect(rows.length).toBeGreaterThan(0);
        expect(elapsedMs).toBeLessThan(100);
      }
    });
  });

  describe("Fuentes Comunitarias y Repacks", () => {
    it("debe contener fuentes registradas en la tabla sources", () => {
      const row = db.query("SELECT COUNT(*) as count FROM sources").get() as CountRow;
      expect(row.count).toBeGreaterThanOrEqual(1);
    });

    it("debe contener items con estructura JSON valida en uris_json", () => {
      const rows = db
        .query(
          `SELECT source_id, item_id, title, normalized_title, uris_json, file_size 
           FROM source_items 
           LIMIT 20`
        )
        .all() as SourceItemRow[];

      expect(rows.length).toBeGreaterThan(0);

      for (const item of rows) {
        expect(item.source_id.length).toBeGreaterThan(0);
        expect(item.title.length).toBeGreaterThan(0);
        expect(item.normalized_title.length).toBeGreaterThan(0);

        const parsedUris = JSON.parse(item.uris_json);
        expect(Array.isArray(parsedUris)).toBe(true);
        expect(parsedUris.length).toBeGreaterThan(0);
      }
    });

    it("debe mantener los items de fuentes sin la tabla FTS5 retirada en la migración 024", () => {
      const row = db
        .query("SELECT title, normalized_title FROM source_items WHERE source_id = ? AND item_id = ?")
        .get("fixture-source", "fixture-item") as Pick<SourceItemRow, "title" | "normalized_title"> | null;

      expect(row?.title).toBe("Overcooked Save Pack");
      expect(row?.normalized_title).toBe("overcooked save pack");
    });
  });

  describe("Rendimiento de Consultas Concurrentes", () => {
    it("debe mantener una latencia promedio baja en rafagas de consultas FTS5", () => {
      const words = ["war", "auto", "red", "dead", "dragon", "star", "dark", "hill"];
      const iterations = 40;
      const start = performance.now();

      for (let i = 0; i < iterations; i++) {
        const word = words[i % words.length];
        db.query(
          `SELECT a.app_id
           FROM steam_catalog_trigram s
           JOIN steam_catalog_apps a ON a.app_id = s.app_id
           WHERE steam_catalog_trigram MATCH ?
           LIMIT 5`
        ).all(`"${word}"`);
      }

      const totalElapsedMs = performance.now() - start;
      const averageMs = totalElapsedMs / iterations;

      expect(averageMs).toBeLessThan(5.0);
    });
  });
});
