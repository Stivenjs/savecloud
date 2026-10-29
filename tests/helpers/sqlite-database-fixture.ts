import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";

/** Creates an isolated SQLite database with deterministic data and the current FTS schema. */
export function createSqliteDatabaseFixture(): Database {
  const db = new Database(":memory:");

  db.run(`
    CREATE TABLE steam_catalog_apps (
      app_id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      catalog_rank_score INTEGER NOT NULL,
      details_json TEXT
    );
    CREATE TABLE steam_catalog_trending (app_id INTEGER PRIMARY KEY, rank INTEGER NOT NULL UNIQUE);
    CREATE TABLE steam_catalog_search (app_id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE steam_app_genres (app_id INTEGER NOT NULL, label TEXT NOT NULL);
    CREATE TABLE steam_app_tags (app_id INTEGER NOT NULL, label TEXT NOT NULL);
    CREATE TABLE steam_appdetails_media_cache (app_id INTEGER PRIMARY KEY, payload TEXT);
    CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, imported_at TEXT NOT NULL);
    CREATE TABLE source_items (
      source_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      uris_json TEXT NOT NULL,
      file_size TEXT,
      PRIMARY KEY (source_id, item_id)
    );
  `);

  const apps = [
    [730, "Deadlock", "deadlock"],
    [1091500, "Cyberpunk 2077", "cyberpunk 2077"],
    [292030, "The Witcher 3: Wild Hunt", "the witcher 3 wild hunt"],
    [230410, "Warframe", "warframe"],
    [271590, "Grand Theft Auto V", "grand theft auto v"],
    [1086940, "Baldur's Gate 3", "baldurs gate 3"],
    [1245620, "ELDEN RING", "elden ring"],
    [1091501, "Red Dead Redemption", "red dead redemption"],
    [1174180, "Red Dead Redemption 2", "red dead redemption 2"],
    [570, "Dota 2", "dota 2"],
  ] as const;

  const insertApp = db.query(
    "INSERT INTO steam_catalog_apps (app_id, name, name_normalized, catalog_rank_score) VALUES (?, ?, ?, ?)"
  );
  apps.forEach(([appId, name, normalizedName], index) => {
    insertApp.run(appId, name, normalizedName, apps.length - index);
    db.query("INSERT INTO steam_catalog_trending (app_id, rank) VALUES (?, ?)").run(appId, index + 1);
    db.query("INSERT INTO steam_app_genres (app_id, label) VALUES (?, ?)").run(appId, "Acción");
    db.query("INSERT INTO steam_app_tags (app_id, label) VALUES (?, ?)").run(appId, "Singleplayer");
  });

  db.query("INSERT INTO sources (id, name, imported_at) VALUES (?, ?, datetime('now'))").run(
    "fixture-source",
    "Fixture source"
  );
  db.query(
    "INSERT INTO source_items (source_id, item_id, title, normalized_title, uris_json, file_size) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    "fixture-source",
    "fixture-item",
    "Overcooked Save Pack",
    "overcooked save pack",
    JSON.stringify(["https://example.invalid/save"]),
    null
  );

  const migrationDirectory = path.resolve(import.meta.dir, "../../apps/desktop/src-tauri/src/sqlite/sql");
  for (const migrationName of [
    "023_fts5_trigram_catalog.sql",
    "024_drop_source_items_trigram.sql",
    "025_download_jobs.sql",
    "026_catalog_relationships.sql",
  ]) {
    const migration = fs.readFileSync(path.join(migrationDirectory, migrationName), "utf8");
    db.run(migration);
  }
  db.run("PRAGMA user_version = 26");

  return db;
}
