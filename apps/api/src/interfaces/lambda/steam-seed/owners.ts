import type { S3Client } from "@aws-sdk/client-s3";
import { listObjects, putJson, getObjectText, isNoSuchKey } from "@interfaces/lambda/steam-seed/s3";
import { STEAM_SEED_MANIFEST_PREFIX, STEAM_SEED_MANIFEST_SUFFIX } from "@interfaces/lambda/steam-seed/layout";

type OwnersStateV1 = {
  version: 1;
  /** Índice round-robin (0..owners.length-1) */
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
 * Devuelve owners que tienen al menos un shard de manifest.
 */
export async function listOwnerIdsWithManifest(s3: S3Client, bucket: string, basePrefix: string): Promise<string[]> {
  const owners: string[] = [];
  let token: string | undefined;
  const prefix = `${basePrefix}/`;
  do {
    const out = await listObjects(s3, bucket, { prefix, delimiter: "/", continuationToken: token, maxKeys: 1000 });
    for (const p of out.commonPrefixes) {
      const rest = p.startsWith(prefix) ? p.slice(prefix.length) : "";
      const ownerId = rest.endsWith("/") ? rest.slice(0, -1) : rest;
      if (ownerId) owners.push(ownerId);
    }
    token = out.nextContinuationToken;
  } while (token);

  const valid: string[] = [];
  for (const ownerId of owners.sort()) {
    const probePrefix = `${basePrefix}/${ownerId}/${STEAM_SEED_MANIFEST_PREFIX}`;
    const probe = await listObjects(s3, bucket, { prefix: probePrefix, maxKeys: 1 });
    if (probe.keys.some((k) => k.endsWith(STEAM_SEED_MANIFEST_SUFFIX))) valid.push(ownerId);
  }
  return valid;
}

/**
 * Selecciona un owner automáticamente para ejecuciones programadas (round-robin).
 *
 * - Si hay owners con manifest, rota entre ellos usando `steam-seed/_owners_state.json`.
 * - Si no hay, devuelve `null` (caller puede caer a modo legacy `steam-seed/manifest/`).
 */
export async function pickOwnerIdAuto(s3: S3Client, bucket: string, basePrefix: string): Promise<string | null> {
  const owners = await listOwnerIdsWithManifest(s3, bucket, basePrefix);
  if (owners.length === 0) return null;

  const ownersStateKey = `${basePrefix}/_owners_state.json`;
  const st = await loadOwnersState(s3, bucket, ownersStateKey);
  const idx = st.cursor % owners.length;
  const chosen = owners[idx] ?? owners[0]!;
  await saveOwnersState(s3, bucket, ownersStateKey, { version: 1, cursor: (idx + 1) % owners.length });
  return chosen;
}
