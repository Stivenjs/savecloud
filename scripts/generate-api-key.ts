#!/usr/bin/env bun
/**
 * Genera API keys con prefijo y formato para Savecloud.
 *
 * Uso:
 *   bun run scripts/generate-api-key.ts
 *   bun run scripts/generate-api-key.ts --live
 *   PREFIX=sg LIVE=1 bun run scripts/generate-api-key.ts
 *   bun run scripts/generate-api-key.ts --count 3
 *
 * Variables de entorno:
 *   PREFIX     Prefijo base (default: sg)
 *   LIVE       1 = prefijo sg_live_, 0 = sg_test_ (default: 0)
 *   LENGTH     Bytes aleatorios (default: 32 → 64 hex)
 *   FORMAT     "compact" | "readable" (default: compact)
 */

import crypto from "node:crypto";

const PREFIX = (process.env.PREFIX ?? "sg").replace(/_+$/, "");
const IS_LIVE = process.env.LIVE === "1" || process.argv.includes("--live");
const ENV_PREFIX = IS_LIVE ? `${PREFIX}_live` : `${PREFIX}_test`;
const LENGTH_BYTES = parseInt(process.env.LENGTH ?? "32", 10) || 32;
const FORMAT = process.env.FORMAT ?? "compact";
const countIdx = process.argv.indexOf("--count");
const COUNT = countIdx >= 0 ? parseInt(process.argv[countIdx + 1], 10) || 1 : 1;

function generateSecureRandom(length: number): Buffer {
  return crypto.randomBytes(length);
}

function toHex(buffer: Buffer): string {
  return buffer.toString("hex");
}

function toReadable(hex: string, chunkSize = 16): string {
  const chunks: string[] = [];
  for (let i = 0; i < hex.length; i += chunkSize) {
    chunks.push(hex.slice(i, i + chunkSize));
  }
  return chunks.join("_");
}

function generateOne(): string {
  const raw = generateSecureRandom(LENGTH_BYTES);
  const hex = toHex(raw);
  const secretPart = FORMAT === "readable" ? toReadable(hex) : hex;
  return `${ENV_PREFIX}_${secretPart}`;
}

const keys = Array.from({ length: COUNT }, () => generateOne());

console.log("");
console.log("# API key(s) generada(s) — no compartas ni subas a repositorios");
console.log("");

if (keys.length === 1) {
  const key = keys[0];
  console.log(key);
  console.log("");
  console.log("# Para .env o deploy (Serverless, etc.):");
  console.log(`SYNC_GAMES_API_KEY=${key}`);
} else {
  keys.forEach((key, i) => {
    console.log(`# Key ${i + 1}`);
    console.log(key);
    console.log("");
  });
  console.log("# Para .env (usa una de las anteriores):");
  console.log(`SYNC_GAMES_API_KEY=${keys[0]}`);
}

console.log("");
