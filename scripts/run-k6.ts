import { buildSync } from "esbuild";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const profile = Bun.argv[2];
if (!profile || !["smoke", "load", "stress", "capacity"].includes(profile)) {
  console.error("Uso: bun run scripts/run-k6.ts <smoke|load|stress|capacity>");
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
const localEnvironment = new Map<string, string>();
const localEnvironmentPath = join(process.cwd(), ".env.k6");

if (existsSync(localEnvironmentPath)) {
  for (const line of readFileSync(localEnvironmentPath, "utf8").split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith("#")) continue;
    const separator = trimmedLine.indexOf("=");
    if (separator < 1) continue;
    localEnvironment.set(trimmedLine.slice(0, separator).trim(), trimmedLine.slice(separator + 1).trim());
  }
}

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
  for (const name of ["BASE_URL", "SYNC_GAMES_API_KEY", "USER_ID", "USER_IDS", "USER_ID_PREFIX"]) {
    const value = process.env[name] || localEnvironment.get(name);
    if (value) args.push("-e", `${name}=${value}`);
  }
  args.push(bundlePath);

  const result = Bun.spawnSync({ cmd: [k6Path, ...args], stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exitCode = result.exitCode;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
