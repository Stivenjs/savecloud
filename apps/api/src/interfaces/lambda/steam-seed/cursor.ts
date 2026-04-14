import type { S3Client } from "@aws-sdk/client-s3";
import type { SteamSeedStateV1 } from "@interfaces/lambda/steam-seed/types";
import { loadManifestLines, parseAppIdLine } from "@interfaces/lambda/steam-seed/manifest";

/**
 * Colecta appids (hasta alcanzar el batchSize) en orden, aplicando avance rápido (Fast-Forward)
 * si el ID ya fue procesado y se encuentra en el historial.
 *
 * @param {S3Client} s3 Cliente de S3.
 * @param {string} bucket Nombre del bucket.
 * @param {string} seedPrefix Prefijo base.
 * @param {SteamSeedStateV1} state Estado actual del cursor.
 * @param {string[] | null} priorityLines Líneas de prioridad.
 * @param {number[]} partIndices Índices disponibles del manifiesto.
 * @param {number} batchSize Cantidad máxima de IDs a recolectar.
 * @param {Set<number>} processedSet Historial de IDs ya resueltos para saltarlos.
 * @returns {Promise<{ appIds: number[]; stateAfter: SteamSeedStateV1 }>} IDs recolectados y el nuevo estado del cursor.
 */
export async function collectAppIds(
  s3: S3Client,
  bucket: string,
  seedPrefix: string,
  state: SteamSeedStateV1,
  priorityLines: string[] | null,
  partIndices: number[],
  batchSize: number,
  processedSet: Set<number>
): Promise<{ appIds: number[]; stateAfter: SteamSeedStateV1 }> {
  const cursor: SteamSeedStateV1 = { ...state };
  const appIds: number[] = [];
  const manifestPrefix = `${seedPrefix}/`;
  let lines = await loadManifestLines(s3, bucket, manifestPrefix, cursor.manifestPart);
  let guard = 0;
  const maxGuard = 500_000;

  while (appIds.length < batchSize && guard < maxGuard) {
    guard += 1;

    if (!cursor.priorityDone && priorityLines) {
      while (cursor.priorityLine < priorityLines.length && appIds.length < batchSize) {
        const id = parseAppIdLine(priorityLines[cursor.priorityLine] ?? "");
        cursor.priorityLine += 1;
        if (id !== null && !processedSet.has(id)) appIds.push(id);
      }
      if (cursor.priorityLine >= priorityLines.length) cursor.priorityDone = true;
      if (appIds.length >= batchSize) break;
    } else {
      cursor.priorityDone = true;
    }

    if (lines === null) break;

    while (cursor.manifestLine < lines.length && appIds.length < batchSize) {
      const id = parseAppIdLine(lines[cursor.manifestLine] ?? "");
      cursor.manifestLine += 1;
      if (id !== null && !processedSet.has(id)) appIds.push(id);
    }

    if (appIds.length >= batchSize) break;

    if (cursor.manifestLine >= lines.length) {
      const idx = partIndices.indexOf(cursor.manifestPart);
      const nextPart = idx >= 0 && idx + 1 < partIndices.length ? partIndices[idx + 1]! : null;
      if (nextPart === null) break;
      cursor.manifestPart = nextPart;
      cursor.manifestLine = 0;
      lines = await loadManifestLines(s3, bucket, manifestPrefix, cursor.manifestPart);
    }
  }

  return { appIds, stateAfter: cursor };
}

/**
 * Evalúa si el flujo completo ha terminado comprobando si es posible extraer al menos 1 ID válido.
 *
 * @param {S3Client} s3 Cliente de S3.
 * @param {string} bucket Nombre del bucket.
 * @param {string} seedPrefix Prefijo base.
 * @param {SteamSeedStateV1} state Estado actual del cursor.
 * @param {string[] | null} priorityLines Líneas de prioridad.
 * @param {number[]} partIndices Índices disponibles del manifiesto.
 * @param {Set<number>} processedSet Historial de IDs procesados.
 * @returns {Promise<boolean>} Verdadero si no quedan IDs por procesar.
 */
export async function isStreamDone(
  s3: S3Client,
  bucket: string,
  seedPrefix: string,
  state: SteamSeedStateV1,
  priorityLines: string[] | null,
  partIndices: number[],
  processedSet: Set<number>
): Promise<boolean> {
  const { appIds } = await collectAppIds(s3, bucket, seedPrefix, state, priorityLines, partIndices, 1, processedSet);
  return appIds.length === 0;
}
