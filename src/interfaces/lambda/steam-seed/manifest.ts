import type { S3Client } from "@aws-sdk/client-s3";
import { listObjects, tryGetObjectText } from "@interfaces/lambda/steam-seed/s3";
import {
  manifestPartKey,
  STEAM_SEED_MANIFEST_PREFIX,
  STEAM_SEED_MANIFEST_SUFFIX,
} from "@interfaces/lambda/steam-seed/layout";

/**
 * Separa por líneas (LF/CRLF).
 */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Parsea una línea de manifest (appid por línea). Soporta comentarios con `#`.
 */
export function parseAppIdLine(line: string): number | null {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Lista índices de shards `manifest/part-xxxxx.txt` existentes.
 */
export async function listManifestPartIndices(s3: S3Client, bucket: string, manifestPrefix: string): Promise<number[]> {
  const fullPrefix = `${manifestPrefix}${STEAM_SEED_MANIFEST_PREFIX}`;
  let token: string | undefined;
  const indices: number[] = [];
  do {
    const out = await listObjects(s3, bucket, { prefix: fullPrefix, continuationToken: token });
    for (const k of out.keys) {
      if (!k.endsWith(STEAM_SEED_MANIFEST_SUFFIX)) continue;
      const base = k.slice(fullPrefix.length, k.length - STEAM_SEED_MANIFEST_SUFFIX.length);
      const n = Number.parseInt(base, 10);
      if (Number.isFinite(n)) indices.push(n);
    }
    token = out.nextContinuationToken;
  } while (token);

  indices.sort((a, b) => a - b);
  return indices;
}

/**
 * Carga las líneas de un shard de manifest; devuelve null si no existe.
 */
export async function loadManifestLines(
  s3: S3Client,
  bucket: string,
  manifestPrefix: string,
  partIndex: number
): Promise<string[] | null> {
  const key = `${manifestPrefix}${manifestPartKey(partIndex)}`;
  const text = await tryGetObjectText(s3, bucket, key);
  if (text === null) return null;
  return splitLines(text);
}
