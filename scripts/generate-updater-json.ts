#!/usr/bin/env bun
/**
 * Genera latest.json para el updater de Tauri a partir de los artifacts descargados en CI.
 *
 * Uso:
 * VERSION=0.1.7 GITHUB_REPOSITORY=Stivenjs/savecloud bun run scripts/generate-updater-json.ts
 */

import { resolve, basename } from "path";
import { mkdir } from "fs/promises";
import { Glob } from "bun";

const raw = process.env.VERSION || process.env.GITHUB_REF?.replace(/^refs\/tags\/v?/, "") || "0.0.0";

const VERSION = raw.replace(/^v/, "");
const REPO = process.env.GITHUB_REPOSITORY || "Stivenjs/savecloud";
const BASE_URL = `https://github.com/${REPO}/releases/download/v${VERSION}`;

const cwd = process.cwd();

const ARTIFACT_PLATFORM: Record<string, string[]> = {
  "desktop-windows": ["windows-x86_64"],
  "desktop-linux": ["linux-x86_64"],
  "desktop-macos-universal": ["darwin-x86_64", "darwin-aarch64"],
};

const platforms: Record<string, { signature: string; url: string }> = {};
const glob = new Glob("**/*.sig");

for (const [artifact, tauriPlatforms] of Object.entries(ARTIFACT_PLATFORM)) {
  const artifactDir = resolve(cwd, artifact);

  const [sigPath] = Array.from(glob.scanSync({ cwd: artifactDir, absolute: true }));

  if (sigPath) {
    const signature = (await Bun.file(sigPath).text()).trim();
    const installerName = basename(sigPath, ".sig");
    const url = `${BASE_URL}/${installerName}`;

    tauriPlatforms.forEach((platform) => {
      platforms[platform] = { signature, url };
    });
  } else {
    console.warn(`No se encontró firma (.sig) para el artifact: ${artifact}`);
  }
}

if (!Object.keys(platforms).length) {
  console.error("No se encontraron archivos .sig. ¿Los artifacts de desktop tienen createUpdaterArtifacts?");
  process.exit(1);
}

let notes = process.env.RELEASE_NOTES?.trim() ?? "";

if (!notes) {
  const notesGlob = new Glob("**/RELEASE_NOTES.md");

  let notesPath: string | null = null;

  for (const match of notesGlob.scanSync({ cwd, absolute: true })) {
    if (match.includes("savecloud-desktop")) {
      notesPath = match;
      break;
    }
  }

  if (notesPath) {
    const notesFile = Bun.file(notesPath);
    if (await notesFile.exists()) {
      notes = (await notesFile.text()).trim();
    }
  } else {
    console.warn("No se encontró RELEASE_NOTES.md en el repositorio");
  }
}

const outputPath = resolve(cwd, "release/latest.json");
await mkdir(resolve(cwd, "release"), { recursive: true });

await Bun.write(
  outputPath,
  JSON.stringify(
    {
      version: VERSION,
      notes,
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2
  )
);

console.log("latest.json generado:", outputPath);
console.log("Plataformas incluidas:", Object.keys(platforms).join(", "));
