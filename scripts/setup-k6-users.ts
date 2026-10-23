import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const userCount = Number(Bun.argv[2] || 100);
const userIdPrefix = (process.env.USER_ID_PREFIX || "savecloud-k6-user").trim();

if (!Number.isInteger(userCount) || userCount < 1 || userCount > 1000) {
  console.error("La cantidad de identidades debe ser un entero entre 1 y 1000.");
  process.exit(2);
}

if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(userIdPrefix)) {
  console.error("USER_ID_PREFIX solo puede contener letras, números, guiones y guiones bajos.");
  process.exit(2);
}

const envPath = join(process.cwd(), ".env.k6");
const existingLines = existsSync(envPath) ? readFileSync(envPath, "utf8").split(/\r?\n/) : [];
const preservedLines = existingLines.filter(
  (line) => !/^\s*(# Identidades de k6|USER_ID_PREFIX|USER_IDS)\s*(=|$)/.test(line)
);
const userIds = Array.from(
  { length: userCount },
  (_, index) => `${userIdPrefix}-${String(index + 1).padStart(3, "0")}`
);
const generatedLines = [
  ...preservedLines.filter((line) => line.trim()),
  "# Identidades de k6 generadas por bun run load:setup",
  `USER_ID_PREFIX=${userIdPrefix}`,
  `USER_IDS=${userIds.join(",")}`,
];

writeFileSync(envPath, `${generatedLines.join("\n")}\n`, "utf8");
console.log(`Se prepararon ${userIds.length} identidades de prueba en .env.k6.`);
console.log(`Rango: ${userIds[0]} … ${userIds[userIds.length - 1]}`);
console.log("El lanzador de k6 cargará estas identidades automáticamente.");
