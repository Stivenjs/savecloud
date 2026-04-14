/**
 * Genera latest.json para GitHub Releases.
 * Ejecutar después de `tauri build` con firma.
 *
 * Uso:
 * bun run scripts/generate-latest-json.ts
 */

import { existsSync } from "fs";
import { resolve, join, basename } from "path";
import { Glob } from "bun";

const baseDir = resolve(import.meta.dir, "..");
const bundleDir = join(baseDir, "src-tauri/target/release/bundle");

const tauriConf = await Bun.file(join(baseDir, "src-tauri/tauri.conf.json")).json();
const VERSION = tauriConf.version;

const endpoints = tauriConf.plugins?.updater?.endpoints?.[0] ?? "";
const [, GITHUB_USER = "Stivenjs", REPO = "savecloud"] = endpoints.match(/github\.com\/([^/]+)\/([^/]+)\//) ?? [];

if (!existsSync(bundleDir)) {
  console.error("No se encontró la carpeta bundle. ¿Ejecutaste `tauri build`?");
  process.exit(1);
}

const sigFiles = Array.from(new Glob("**/*.sig").scanSync({ cwd: bundleDir, absolute: true }));

if (!sigFiles.length) {
  console.error("No se encontraron archivos .sig. ¿Hiciste `tauri build` con firma?");
  process.exit(1);
}

const platforms: Record<string, { signature: string; url: string }> = {};

const extMap: Record<string, string[]> = {
  ".exe": ["windows-x86_64"],
  ".AppImage": ["linux-x86_64"],
  ".deb": ["linux-x86_64"],
  ".rpm": ["linux-x86_64"],
  ".app.tar.gz": ["darwin-x86_64", "darwin-aarch64"],
};

for (const sigPath of sigFiles) {
  const installerName = basename(sigPath, ".sig");
  const ext = Object.keys(extMap).find((e) => installerName.endsWith(e));

  if (ext) {
    const signature = (await Bun.file(sigPath).text()).trim();
    const url = `https://github.com/${GITHUB_USER}/${REPO}/releases/download/v${VERSION}/${installerName}`;

    extMap[ext].forEach((target) => {
      platforms[target] = { signature, url };
    });
  }
}

if (!Object.keys(platforms).length) {
  console.error("No se pudieron detectar plataformas válidas.");
  process.exit(1);
}

const outputPath = join(baseDir, "latest.json");

await Bun.write(
  outputPath,
  JSON.stringify(
    {
      version: VERSION,
      notes: "",
      pub_date: new Date().toISOString(),
      platforms,
    },
    null,
    2
  )
);

console.log("latest.json generado en:", outputPath);
console.log("Plataformas detectadas:", Object.keys(platforms).join(", "));
console.log("Súbelo como asset en tu release de GitHub.");
