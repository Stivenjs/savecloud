import type { S3Client } from "@aws-sdk/client-s3";
import { listObjects, putJson, getObjectText, isNoSuchKey } from "@interfaces/lambda/steam-seed/s3";
import { listSteamSeedOwnerIdsWithManifest as listOwnerIdsWithManifest } from "@infrastructure/storage/steam-seed-owners";

type OwnersStateV1 = {
  version: 1;
  /** Índice de rotación (0..cantidad de propietarios - 1). */
  cursor: number;
};

function defaultOwnersState(): OwnersStateV1 {
  return { version: 1, cursor: 0 };
}

async function loadOwnersState(s3: S3Client, bucket: string, key: string): Promise<OwnersStateV1> {
  try {
    const raw = await getObjectText(s3, bucket, key);
    const parsed = JSON.parse(raw) as OwnersStateV1;
    if (parsed?.version !== 1) return defaultOwnersState();
    return { ...defaultOwnersState(), ...parsed };
  } catch (e) {
    if (isNoSuchKey(e)) return defaultOwnersState();
    throw e;
  }
}

async function saveOwnersState(s3: S3Client, bucket: string, key: string, state: OwnersStateV1): Promise<void> {
  await putJson(s3, bucket, key, state);
}

/**
 * Selecciona automáticamente un propietario para las ejecuciones programadas.
 *
 * - Si hay propietarios con manifiestos, los recorre usando `steam-seed/_owners_state.json`.
 * - `task` opcional mantiene cursores independientes para detalles y reseñas.
 * - Si no hay propietarios, devuelve `null` para que el llamador use el modo anterior.
 */
export async function pickOwnerIdAuto(
  s3: S3Client,
  bucket: string,
  basePrefix: string,
  task?: "details" | "reviews"
): Promise<string | null> {
  const owners = await listOwnerIdsWithManifest(s3, bucket, basePrefix);
  if (owners.length === 0) return null;

  const ownersStateKey = `${basePrefix}/_owners_state${task ? `_${task}` : ""}.json`;
  const st = await loadOwnersState(s3, bucket, ownersStateKey);
  const idx = st.cursor % owners.length;
  const chosen = owners[idx] ?? owners[0]!;
  await saveOwnersState(s3, bucket, ownersStateKey, { version: 1, cursor: (idx + 1) % owners.length });
  return chosen;
}
