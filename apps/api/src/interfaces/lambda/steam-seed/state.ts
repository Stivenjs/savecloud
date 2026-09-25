import type { S3Client } from "@aws-sdk/client-s3";
import type { SteamSeedStateV1 } from "@interfaces/lambda/steam-seed/types";
import { getObjectText, isNoSuchKey, putJson } from "@interfaces/lambda/steam-seed/s3";

/**
 * Genera el estado inicial por defecto para un owner del seed.
 * Incluye la nueva propiedad manifestSignature.
 *
 * @returns {SteamSeedStateV1} Estado por defecto.
 */
export function defaultSteamSeedState(): SteamSeedStateV1 {
  return {
    version: 1,
    priorityLine: 0,
    priorityDone: false,
    prioritySignature: null,
    manifestSignature: null,
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
 * Carga el estado `state.json` desde S3. Si no existe, devuelve el estado por defecto.
 *
 * @param {S3Client} s3 Cliente de S3.
 * @param {string} bucket Nombre del bucket.
 * @param {string} key Ruta completa del estado en S3.
 * @returns {Promise<SteamSeedStateV1>} El estado actual o por defecto.
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
 * Persiste el estado actual `state.json` en S3.
 *
 * @param {S3Client} s3 Cliente de S3.
 * @param {string} bucket Nombre del bucket.
 * @param {string} key Ruta completa del estado en S3.
 * @param {SteamSeedStateV1} state Objeto de estado a guardar.
 */
export async function saveSteamSeedState(
  s3: S3Client,
  bucket: string,
  key: string,
  state: SteamSeedStateV1
): Promise<void> {
  await putJson(s3, bucket, key, state);
}

/**
 * Carga el historial de AppIDs que ya han sido procesados exitosamente (o que no existen en Steam).
 *
 * @param {S3Client} s3 Cliente de S3.
 * @param {string} bucket Nombre del bucket.
 * @param {string} seedPrefix Prefijo base del owner.
 * @returns {Promise<Set<number>>} Set con los IDs ya procesados.
 */
export async function loadProcessedAppIds(s3: S3Client, bucket: string, seedPrefix: string): Promise<Set<number>> {
  try {
    const key = `${seedPrefix}/processed_appids.json`;
    const raw = await getObjectText(s3, bucket, key);
    const parsed = JSON.parse(raw) as number[];
    return new Set(parsed);
  } catch (e) {
    if (isNoSuchKey(e)) return new Set();
    throw e;
  }
}

/**
 * Persiste el historial de AppIDs procesados para evitar peticiones duplicadas en futuras ejecuciones.
 *
 * @param {S3Client} s3 Cliente de S3.
 * @param {string} bucket Nombre del bucket.
 * @param {string} seedPrefix Prefijo base del owner.
 * @param {Set<number>} processedSet Set con los IDs a guardar.
 */
export async function saveProcessedAppIds(
  s3: S3Client,
  bucket: string,
  seedPrefix: string,
  processedSet: Set<number>
): Promise<void> {
  const key = `${seedPrefix}/processed_appids.json`;
  await putJson(s3, bucket, key, Array.from(processedSet));
}
