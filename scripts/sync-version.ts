#!/usr/bin/env bun
/**
 * Sincroniza la versión desde el tag de Git, variable de entorno o argumento CLI.
 * * Uso local: bun run scripts/sync-version.ts 0.1.7
 * Uso CI: GITHUB_REF=refs/tags/v0.1.7 bun run scripts/sync-version.ts
 */

import { resolve } from "path";

const argVersion = process.argv[2];
const envVersion =
  process.env.VERSION || process.env.GITHUB_REF?.replace(/^refs\/tags\//, "");

const rawVersion = argVersion || envVersion || "0.0.0";

const version = rawVersion.replace(/^v/, "");

const root = process.cwd();

const filesToUpdate = [
  "package.json",
  "apps/sync-games-desktop/package.json",
  "apps/sync-games-desktop/src-tauri/tauri.conf.json",
];

let updatedCount = 0;

for (const relPath of filesToUpdate) {
  const fullPath = resolve(root, relPath);
  const file = Bun.file(fullPath);

  if (await file.exists()) {
    const json = await file.json();
    json.version = version;
    await Bun.write(fullPath, JSON.stringify(json, null, 2) + "\n");
    updatedCount++;
  } else {
    console.warn(`[Advertencia] Archivo no encontrado, se omite: ${relPath}`);
  }
}

if (updatedCount === 0) {
  console.error(
    "Error: No se actualizó ningún archivo. Verifica que ejecutas el script desde la raíz del proyecto."
  );
  process.exit(1);
}

console.log(`Versión sincronizada a ${version} en ${updatedCount} archivos.`);
