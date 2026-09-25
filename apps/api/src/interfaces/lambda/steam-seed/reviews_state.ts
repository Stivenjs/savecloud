import type { S3Client } from "@aws-sdk/client-s3";
import type { SteamReviewsStateV1 } from "@interfaces/lambda/steam-seed/types";
import { getObjectText, isNoSuchKey, putJson } from "@interfaces/lambda/steam-seed/s3";
import { STEAM_REVIEWS_STATE_KEY } from "@interfaces/lambda/steam-seed/layout";

/**
 * Devuelve el estado inicial (vacío) del cursor de reseñas.
 */
export function defaultReviewsState(): SteamReviewsStateV1 {
  return {
    version: 1,
    offset: 0,
    batchSeq: 0,
    backoffUntil: null,
    totals: {
      processed: 0,
      ok: 0,
      notFound: 0,
      httpErrors: 0,
    },
  };
}

/**
 * Carga `reviews_state.json` desde S3. Devuelve el estado por defecto si el
 * objeto aún no existe (primera ejecución) o tiene una versión incompatible.
 */
export async function loadReviewsState(s3: S3Client, bucket: string, seedPrefix: string): Promise<SteamReviewsStateV1> {
  const key = `${seedPrefix}/${STEAM_REVIEWS_STATE_KEY}`;
  try {
    const raw = await getObjectText(s3, bucket, key);
    const parsed = JSON.parse(raw) as SteamReviewsStateV1;
    if (parsed?.version !== 1) return defaultReviewsState();
    const base = defaultReviewsState();
    return { ...base, ...parsed, totals: { ...base.totals, ...parsed.totals } };
  } catch (e) {
    if (isNoSuchKey(e)) return defaultReviewsState();
    throw e;
  }
}

/**
 * Persiste el estado del cursor de reseñas en S3.
 */
export async function saveReviewsState(
  s3: S3Client,
  bucket: string,
  seedPrefix: string,
  state: SteamReviewsStateV1
): Promise<void> {
  const key = `${seedPrefix}/${STEAM_REVIEWS_STATE_KEY}`;
  await putJson(s3, bucket, key, state);
}
