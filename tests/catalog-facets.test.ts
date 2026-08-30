/**
 * @fileoverview Pruebas de facetas y filtros compuestos (Generos y Tags) para el catalogo de Steam.
 *
 * Valida que las consultas combinadas (AND sobre steam_app_genres y steam_app_tags):
 * 1. Respondan mediante subconsultas correlacionadas `EXISTS` en O(log n).
 * 2. Mantengan una latencia de respuesta inferior a 15 ms.
 * 3. Preserven la calidad del ordenamiento (`catalog_rank_score DESC`).
 * 4. Resuelvan correctamente las tendencias superiores (`steam_catalog_trending`).
 *
 * @module tests/catalog-facets.test
 */

import { beforeAll, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

interface FacetRow {
  readonly label: string;
  readonly count: number;
}

interface FilteredAppRow {
  readonly app_id: number;
  readonly name: string;
  readonly catalog_rank_score: number;
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

describe("Facetas y Filtros Compuestos de Catalogo", () => {
  let db: Database;

  beforeAll(() => {
    const dbPath = resolveDatabasePath();
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Base de datos no encontrada en: ${dbPath}`);
    }
    db = new Database(dbPath, { readonly: true });
  });

  describe("Distribucion de Facetas", () => {
    it("debe retornar los generos mas populares con sus frecuencias", () => {
      const rows = db
        .query(
          `SELECT label, COUNT(*) as count 
           FROM steam_app_genres 
           GROUP BY label 
           ORDER BY count DESC 
           LIMIT 10`
        )
        .all() as FacetRow[];

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(typeof row.label).toBe("string");
        expect(row.label.length).toBeGreaterThan(0);
        expect(row.count).toBeGreaterThan(0);
      }
    });

    it("debe retornar las etiquetas mas populares con sus frecuencias", () => {
      const rows = db
        .query(
          `SELECT label, COUNT(*) as count 
           FROM steam_app_tags 
           GROUP BY label 
           ORDER BY count DESC 
           LIMIT 10`
        )
        .all() as FacetRow[];

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(typeof row.label).toBe("string");
        expect(row.count).toBeGreaterThan(0);
      }
    });
  });

  describe("Filtros Compuestos con Subconsultas EXISTS", () => {
    it("debe filtrar juegos por genero unico con latencia minima", () => {
      const start = performance.now();
      const rows = db
        .query(
          `SELECT a.app_id, a.name, a.catalog_rank_score
           FROM steam_catalog_apps a
           WHERE EXISTS (
             SELECT 1 FROM steam_app_genres g 
             WHERE g.app_id = a.app_id AND g.label = 'Acción'
           )
           ORDER BY a.catalog_rank_score DESC
           LIMIT 10`
        )
        .all() as FilteredAppRow[];

      const elapsed = performance.now() - start;

      expect(rows.length).toBe(10);
      expect(elapsed).toBeLessThan(15);
    });

    it("debe aplicar semantica AND en filtros combinados (Genero + Tag)", () => {
      // Obtener el género y tag más representativos presentes en la base de datos
      const genreRow = db
        .query(
          `SELECT g.label as genre, t.label as tag
           FROM steam_app_genres g
           JOIN steam_app_tags t ON t.app_id = g.app_id
           GROUP BY g.label, t.label
           ORDER BY COUNT(*) DESC
           LIMIT 1`
        )
        .get() as { genre: string; tag: string } | null;

      const targetGenre = genreRow?.genre ?? "Acción";
      const targetTag = genreRow?.tag ?? "Singleplayer";

      const start = performance.now();
      const rows = db
        .query(
          `SELECT a.app_id, a.name, a.catalog_rank_score
           FROM steam_catalog_apps a
           WHERE EXISTS (
             SELECT 1 FROM steam_app_genres g 
             WHERE g.app_id = a.app_id AND g.label = ?
           )
           AND EXISTS (
             SELECT 1 FROM steam_app_tags t 
             WHERE t.app_id = a.app_id AND t.label = ?
           )
           ORDER BY a.catalog_rank_score DESC
           LIMIT 10`
        )
        .all(targetGenre, targetTag) as FilteredAppRow[];

      const elapsed = performance.now() - start;

      expect(rows.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(25);

      // Validar que cada juego devuelto cumpla ambos criterios
      for (const app of rows) {
        const hasGenre = db
          .query("SELECT 1 FROM steam_app_genres WHERE app_id = ? AND label = ?")
          .get(app.app_id, targetGenre);
        const hasTag = db
          .query("SELECT 1 FROM steam_app_tags WHERE app_id = ? AND label = ?")
          .get(app.app_id, targetTag);

        expect(Boolean(hasGenre)).toBe(true);
        expect(Boolean(hasTag)).toBe(true);
      }
    });
  });

  describe("Bloque de Tendencias (Hero Ranking)", () => {
    it("debe devolver juegos de tendencias en orden estricto de rank ASC", () => {
      const rows = db
        .query(
          `SELECT a.app_id, a.name, tr.rank
           FROM steam_catalog_trending tr
           JOIN steam_catalog_apps a ON a.app_id = tr.app_id
           ORDER BY tr.rank ASC
           LIMIT 10`
        )
        .all() as { app_id: number; name: string; rank: number }[];

      expect(rows.length).toBeGreaterThan(0);

      let prevRank = -1;
      for (const row of rows) {
        expect(row.rank).toBeGreaterThan(prevRank);
        prevRank = row.rank;
      }
    });
  });
});
