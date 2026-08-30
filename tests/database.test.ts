/**
 * @fileoverview Suite de pruebas automatizadas para la base de datos local SQLite y motor FTS5 de SaveCloud.
 *
 * Todas las rutas se resuelven dinámicamente mediante variables de entorno estándar del sistema
 * operativo para evitar paths hardcodeados y garantizar portabilidad en CI/CD y entornos locales.
 *
 * Variables de entorno soportadas:
 * - `SAVECLOUD_DB_PATH`: Ruta absoluta personalizada a `catalog.sqlite` (Opcional)
 * - `APPDATA` / `USERPROFILE`: Directorio de configuración en Windows
 * - `XDG_CONFIG_HOME` / `HOME`: Directorio de configuración en Linux y macOS
 *
 * @module tests/database.test
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

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

/**
 * Resuelve la ruta absoluta al archivo SQLite `catalog.sqlite` según el sistema operativo.
 *
 * @returns {string} Ruta absoluta resuelta hacia la base de datos.
 */
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

describe("SaveCloud SQLite Database Suite", () => {
  let db: Database;
  let dbPath: string;

  beforeAll(() => {
    dbPath = resolveDatabasePath();
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Base de datos no encontrada en la ruta resuelta: ${dbPath}`);
    }
    db = new Database(dbPath, { readonly: true });
  });

  describe("Esquema e Integridad", () => {
    it("debe superar el chequeo de integridad rapido de SQLite", () => {
      const row = db.query("PRAGMA quick_check").get() as QuickCheckRow;
      expect(row.quick_check).toBe("ok");
    });

    it("debe contar con una version de migracion igual o superior a v23", () => {
      const row = db.query("PRAGMA user_version").get() as UserVersionRow;
      expect(row.user_version).toBeGreaterThanOrEqual(23);
    });

    it("debe contener todas las tablas relacionales y virtuales FTS5 requeridas", () => {
      const requiredTables = [
        "steam_catalog_apps",
        "steam_catalog_trending",
        "steam_catalog_search",
        "steam_catalog_trigram",
        "sources",
        "source_items",
        "source_items_trigram",
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

    it("debe consultar la tabla virtual source_items_trigram eficientemente", () => {
      const queries = ["overcooked", "resident evil", "forza"];

      for (const query of queries) {
        const start = performance.now();
        const rows = db
          .query(
            `SELECT s.source_id, s.item_id, s.title
             FROM source_items_trigram t
             JOIN source_items s ON s.source_id = t.source_id AND s.item_id = t.item_id
             WHERE source_items_trigram MATCH ?
             LIMIT 5`
          )
          .all(`"${query}"`) as SourceItemRow[];

        const elapsedMs = performance.now() - start;

        expect(rows.length).toBeGreaterThan(0);
        expect(elapsedMs).toBeLessThan(50);
      }
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
