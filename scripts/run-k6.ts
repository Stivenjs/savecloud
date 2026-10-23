import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const profile = Bun.argv[2];
if (!profile || !["smoke", "load", "stress"].includes(profile)) {
  console.error("Uso: bun run scripts/run-k6.ts <smoke|load|stress>");
  process.exit(2);
}

const k6Path = Bun.which("k6");
if (!k6Path) {
  console.error(
    "No se encontró k6 en PATH. Instálalo desde https://grafana.com/docs/k6/latest/set-up/install-k6/ y vuelve a abrir la terminal."
  );
  process.exit(127);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "savecloud-k6-"));
const bundlePath = join(temporaryDirectory, "api.js");

try {
  buildSync({
    entryPoints: ["tests/load/k6/api.ts"],
    bundle: true,
    platform: "neutral",
    format: "esm",
    outfile: bundlePath,
    tsconfig: "tests/load/k6/tsconfig.json",
    external: ["k6", "k6/*"],
  });

  const args = ["run", "-e", `TEST_PROFILE=${profile}`];
  for (const name of ["BASE_URL", "SYNC_GAMES_API_KEY"]) {
    const value = process.env[name];
    if (value) args.push("-e", `${name}=${value}`);
  }
  args.push(bundlePath);

  const result = Bun.spawnSync({ cmd: [k6Path, ...args], stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exitCode = result.exitCode;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
