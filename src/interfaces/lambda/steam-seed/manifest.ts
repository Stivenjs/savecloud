import { ListObjectsV2Command, type S3Client } from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import { tryGetObjectText } from "@interfaces/lambda/steam-seed/s3";
import {
  manifestPartKey,
  STEAM_SEED_MANIFEST_PREFIX,
  STEAM_SEED_MANIFEST_SUFFIX,
} from "@interfaces/lambda/steam-seed/layout";

/**
 * Separa un texto por líneas soportando LF o CRLF.
 *
 * @param {string} text Texto a separar.
 * @returns {string[]} Arreglo de líneas.
 */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Parsea una línea de manifiesto para extraer un AppID. Ignora comentarios y líneas vacías.
 *
 * @param {string} line Línea a evaluar.
 * @returns {number | null} El AppID válido o null si es inválido.
 */
export function parseAppIdLine(line: string): number | null {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Obtiene los índices de las partes del manifiesto y calcula una firma única (hash)
 * basada en los ETags de S3. Esto permite detectar si los archivos fueron reemplazados.
 *
 * @param {S3Client} s3 Cliente de S3.
 * @param {string} bucket Nombre del bucket.
 * @param {string} manifestPrefix Prefijo de los manifiestos.
 * @returns {Promise<{ indices: number[]; signature: string }>} Índices ordenados y la firma resultante.
 */
export async function getManifestSignatureAndIndices(
  s3: S3Client,
  bucket: string,
  manifestPrefix: string
): Promise<{ indices: number[]; signature: string }> {
  const fullPrefix = `${manifestPrefix}${STEAM_SEED_MANIFEST_PREFIX}`;
  let token: string | undefined;
  const parts: { index: number; etag: string }[] = [];

  do {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: fullPrefix,
        ContinuationToken: token,
      })
    );

    for (const obj of out.Contents ?? []) {
      if (!obj.Key?.endsWith(STEAM_SEED_MANIFEST_SUFFIX)) continue;
      const base = obj.Key.slice(fullPrefix.length, obj.Key.length - STEAM_SEED_MANIFEST_SUFFIX.length);
      const n = Number.parseInt(base, 10);
      if (Number.isFinite(n)) {
        parts.push({ index: n, etag: obj.ETag ?? "" });
      }
    }
    token = out.NextContinuationToken;
  } while (token);

  parts.sort((a, b) => a.index - b.index);

  // Generamos un hash a partir de los índices y sus ETags correspondientes para detectar cambios mínimos
  const hashContent = parts.map((p) => `${p.index}:${p.etag}`).join("|");
  const signature = createHash("sha1").update(hashContent).digest("hex");

  return { indices: parts.map((p) => p.index), signature };
}

/**
 * Carga las líneas de un shard de manifiesto específico.
 *
 * @param {S3Client} s3 Cliente de S3.
 * @param {string} bucket Nombre del bucket.
 * @param {string} manifestPrefix Prefijo del manifiesto.
 * @param {number} partIndex Índice del archivo a cargar.
 * @returns {Promise<string[] | null>} Líneas del archivo o null si no existe.
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

// Mantenemos esta función por retrocompatibilidad con importaciones antiguas si es necesario.
export async function listManifestPartIndices(s3: S3Client, bucket: string, manifestPrefix: string): Promise<number[]> {
  const { indices } = await getManifestSignatureAndIndices(s3, bucket, manifestPrefix);
  return indices;
}
