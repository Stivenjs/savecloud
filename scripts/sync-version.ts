#!/usr/bin/env bun
/**
 * Sincroniza la versión desde el tag de Git, variable de entorno o argumento CLI.
 *
 * Uso local:
 * bun run scripts/sync-version.ts 0.1.7
 *
 * Uso CI:
 * GITHUB_REF=refs/tags/v0.1.7 bun run scripts/sync-version.ts
 */

import { resolve } from "path";

const argVersion = process.argv[2];
const envVersion = process.env.VERSION || process.env.GITHUB_REF?.replace(/^refs\/tags\//, "");

const rawVersion = argVersion || envVersion || "0.0.0";
const version = rawVersion.replace(/^v/, "");

const root = process.cwd();

const jsonFiles = [
  "package.json",
  "apps/savecloud-desktop/package.json",
  "apps/savecloud-desktop/src-tauri/tauri.conf.json",
];

const tomlFiles = ["apps/savecloud-desktop/src-tauri/Cargo.toml"];

let updatedCount = 0;

for (const relPath of jsonFiles) {
  const fullPath = resolve(root, relPath);
  const file = Bun.file(fullPath);

  if (!(await file.exists())) {
    console.warn(`[Advertencia] Archivo no encontrado: ${relPath}`);
    continue;
  }

  const json = await file.json();
  json.version = version;

  await Bun.write(fullPath, JSON.stringify(json, null, 2) + "\n");
  updatedCount++;
}

for (const relPath of tomlFiles) {
  const fullPath = resolve(root, relPath);
  const file = Bun.file(fullPath);

  if (!(await file.exists())) {
    console.warn(`[Advertencia] Archivo no encontrado: ${relPath}`);
    continue;
  }

  let content = await file.text();

  content = content.replace(/version\s*=\s*".*?"/, `version = "${version}"`);

  await Bun.write(fullPath, content);
  updatedCount++;
}

if (updatedCount === 0) {
  console.error("Error: No se actualizó ningún archivo. Ejecuta el script desde la raíz del proyecto.");
  process.exit(1);
}

console.log(`Versión sincronizada a ${version} en ${updatedCount} archivos.`);
