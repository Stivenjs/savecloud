import type { S3Client } from "@aws-sdk/client-s3";
import type { SteamSeedStateV1 } from "@interfaces/lambda/steam-seed/types";
import { loadManifestLines, parseAppIdLine } from "@interfaces/lambda/steam-seed/manifest";

/**
 * Consume exactamente `limit` appids válidos desde `state` (priority, luego manifest por shards).
 * Devuelve el cursor resultante y cuántos ids válidos se consumieron realmente.
 */
export async function takeUpToNAppIds(params: {
  s3: S3Client;
  bucket: string;
  seedPrefix: string;
  state: SteamSeedStateV1;
  priorityLines: string[] | null;
  partIndices: number[];
  limit: number;
}): Promise<{ stateAfter: SteamSeedStateV1; took: number }> {
  const { s3, bucket, seedPrefix, priorityLines, partIndices, limit } = params;
  const cursor: SteamSeedStateV1 = { ...params.state };
  const manifestPrefix = `${seedPrefix}/`;
  let took = 0;
  let lines = await loadManifestLines(s3, bucket, manifestPrefix, cursor.manifestPart);
  let guard = 0;
  const maxGuard = 500_000;

  while (took < limit && guard < maxGuard) {
    guard += 1;

    if (!cursor.priorityDone && priorityLines) {
      while (cursor.priorityLine < priorityLines.length && took < limit) {
        const id = parseAppIdLine(priorityLines[cursor.priorityLine] ?? "");
        cursor.priorityLine += 1;
        if (id !== null) took += 1;
      }
      if (cursor.priorityLine >= priorityLines.length) cursor.priorityDone = true;
      if (took >= limit) break;
    } else {
      cursor.priorityDone = true;
    }

    if (lines === null) break;

    while (cursor.manifestLine < lines.length && took < limit) {
      const id = parseAppIdLine(lines[cursor.manifestLine] ?? "");
      cursor.manifestLine += 1;
      if (id !== null) took += 1;
    }

    if (took >= limit) break;

    if (cursor.manifestLine >= lines.length) {
      const idx = partIndices.indexOf(cursor.manifestPart);
      const nextPart = idx >= 0 && idx + 1 < partIndices.length ? partIndices[idx + 1]! : null;
      if (nextPart === null) break;
      cursor.manifestPart = nextPart;
      cursor.manifestLine = 0;
      lines = await loadManifestLines(s3, bucket, manifestPrefix, cursor.manifestPart);
    }
  }

  return { stateAfter: cursor, took };
}

/**
 * Colecta appids (hasta batchSize) en orden, sin persistir cambios.
 */
export async function collectAppIds(
  s3: S3Client,
  bucket: string,
  seedPrefix: string,
  state: SteamSeedStateV1,
  priorityLines: string[] | null,
  partIndices: number[],
  batchSize: number
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
        if (id !== null) appIds.push(id);
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
      if (id !== null) appIds.push(id);
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
 * Indica si no quedan appids para procesar.
 */
export async function isStreamDone(
  s3: S3Client,
  bucket: string,
  seedPrefix: string,
  state: SteamSeedStateV1,
  priorityLines: string[] | null,
  partIndices: number[]
): Promise<boolean> {
  const { appIds } = await collectAppIds(s3, bucket, seedPrefix, state, priorityLines, partIndices, 1);
  return appIds.length === 0;
}
