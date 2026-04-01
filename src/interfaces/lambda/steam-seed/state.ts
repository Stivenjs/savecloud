import type { S3Client } from "@aws-sdk/client-s3";
import type { SteamSeedStateV1 } from "@interfaces/lambda/steam-seed/types";
import { getObjectText, isNoSuchKey, putJson } from "@interfaces/lambda/steam-seed/s3";

/**
 * Estado por owner del seed (cursor + backoff + contadores).
 */
export function defaultSteamSeedState(): SteamSeedStateV1 {
  return {
    version: 1,
    priorityLine: 0,
    priorityDone: false,
    manifestPart: 0,
    manifestLine: 0,
    batchSeq: 0,
    backoffUntil: null,
    catalogComplete: false,
    totals: {
      processed: 0,
      steamOk: 0,
      steamNotFound: 0,
      httpErrors: 0,
    },
  };
}

/**
 * Carga `state.json` de S3; si no existe, devuelve default.
 */
export async function loadSteamSeedState(s3: S3Client, bucket: string, key: string): Promise<SteamSeedStateV1> {
  try {
    const raw = await getObjectText(s3, bucket, key);
    const parsed = JSON.parse(raw) as SteamSeedStateV1;
    if (parsed?.version !== 1) return defaultSteamSeedState();
    const base = defaultSteamSeedState();
    return { ...base, ...parsed, totals: { ...base.totals, ...parsed.totals } };
  } catch (e) {
    if (isNoSuchKey(e)) return defaultSteamSeedState();
    throw e;
  }
}

/**
 * Persiste `state.json` a S3.
 */
export async function saveSteamSeedState(
  s3: S3Client,
  bucket: string,
  key: string,
  state: SteamSeedStateV1
): Promise<void> {
  await putJson(s3, bucket, key, state);
}
