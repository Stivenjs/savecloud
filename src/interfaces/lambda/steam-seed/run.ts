import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { BatchLineV1, SteamSeedStateV1 } from "@interfaces/lambda/steam-seed/types";
import {
  batchKey,
  DEFAULT_STEAM_FILTERS,
  STEAM_SEED_PRIORITY_KEY,
  STEAM_SEED_STATE_KEY,
} from "@interfaces/lambda/steam-seed/layout";
import { collectAppIds, isStreamDone } from "@interfaces/lambda/steam-seed/cursor";
import { listManifestPartIndices, splitLines } from "@interfaces/lambda/steam-seed/manifest";
import { tryGetObjectText } from "@interfaces/lambda/steam-seed/s3";
import { fetchSteamAppDetails } from "@interfaces/lambda/steam-seed/steam";
import { loadSteamSeedState, saveSteamSeedState } from "@interfaces/lambda/steam-seed/state";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envStr(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/**
 * Ejecuta un “tick” del worker para un `seedPrefix` concreto.
 *
 * - Respeta backoff por 429.
 * - Lee prioridad (si existe) + manifest shards.
 * - Escribe un batch NDJSON a S3 y avanza el cursor en `state.json`.
 */
export async function runSteamSeedTick(params: { s3: S3Client; bucket: string; seedPrefix: string }): Promise<{
  seedPrefix: string;
  stateBefore: SteamSeedStateV1;
  stateAfter: SteamSeedStateV1;
  wroteBatchKey?: string;
  done: boolean;
  reason?: "backoff_active" | "no_manifest_parts" | "catalog_complete" | "batch_written";
}> {
  const { s3, bucket, seedPrefix } = params;

  const delayMs = envInt("STEAM_DELAY_MS", 2000);
  const batchSize = envInt("STEAM_BATCH_SIZE", 8);
  const backoffMinutes = envInt("STEAM_BACKOFF_MINUTES", 30);
  const lang = envStr("STEAM_LANG", "spanish");
  const filters = envStr("STEAM_FILTERS", DEFAULT_STEAM_FILTERS);

  const stateKey = `${seedPrefix}/${STEAM_SEED_STATE_KEY}`;
  const manifestPrefix = `${seedPrefix}/`;
  const priorityKey = `${seedPrefix}/${STEAM_SEED_PRIORITY_KEY}`;

  const stateBefore = await loadSteamSeedState(s3, bucket, stateKey);
  let state: SteamSeedStateV1 = { ...stateBefore };

  if (state.backoffUntil) {
    const until = new Date(state.backoffUntil).getTime();
    if (Number.isFinite(until) && until > Date.now()) {
      return { seedPrefix, stateBefore, stateAfter: state, done: false, reason: "backoff_active" };
    }
  }

  const priorityText = await tryGetObjectText(s3, bucket, priorityKey);
  const priorityLines = priorityText === null ? null : splitLines(priorityText);

  const partIndices = await listManifestPartIndices(s3, bucket, manifestPrefix);
  if (partIndices.length === 0) {
    // Sin manifest, no hay nada que hacer.
    return { seedPrefix, stateBefore, stateAfter: state, done: true, reason: "no_manifest_parts" };
  }

  const done = await isStreamDone(s3, bucket, seedPrefix, state, priorityLines, partIndices);
  if (done) {
    if (!state.catalogComplete) {
      state = { ...state, catalogComplete: true };
      await saveSteamSeedState(s3, bucket, stateKey, state);
    }
    return { seedPrefix, stateBefore, stateAfter: state, done: true, reason: "catalog_complete" };
  }

  const { appIds, stateAfter } = await collectAppIds(
    s3,
    bucket,
    seedPrefix,
    state,
    priorityLines,
    partIndices,
    batchSize
  );
  if (appIds.length === 0) {
    return { seedPrefix, stateBefore, stateAfter: state, done: true };
  }

  const lines: string[] = [];
  let steamOk = 0;
  let steamNotFound = 0;
  let httpErrors = 0;

  for (const appId of appIds) {
    await sleep(delayMs);
    const r = await fetchSteamAppDetails(appId, lang, filters);
    const fetchedAt = new Date().toISOString();

    if (r.httpStatus === 429) {
      const until = new Date(Date.now() + backoffMinutes * 60_000).toISOString();
      state = { ...state, backoffUntil: until, totals: { ...state.totals, httpErrors: state.totals.httpErrors + 1 } };
      await saveSteamSeedState(s3, bucket, stateKey, state);
      return { seedPrefix, stateBefore, stateAfter: state, done: false };
    }

    if (r.steamSuccess === true) {
      steamOk += 1;
      const line: BatchLineV1 = { appId, fetchedAt, httpStatus: r.httpStatus, steamSuccess: true, data: r.data };
      lines.push(JSON.stringify(line));
    } else if (r.steamSuccess === false) {
      steamNotFound += 1;
      const line: BatchLineV1 = { appId, fetchedAt, httpStatus: r.httpStatus, steamSuccess: false };
      lines.push(JSON.stringify(line));
    } else {
      httpErrors += 1;
      const line: BatchLineV1 = {
        appId,
        fetchedAt,
        httpStatus: r.httpStatus,
        steamSuccess: null,
        error: r.error ?? "http_error",
      };
      lines.push(JSON.stringify(line));
    }
  }

  const wroteKey = `${seedPrefix}/${batchKey(state.batchSeq)}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: wroteKey,
      Body: lines.join("\n") + "\n",
      ContentType: "application/x-ndjson",
    })
  );

  state = {
    ...stateAfter,
    batchSeq: state.batchSeq + 1,
    backoffUntil: null,
    totals: {
      processed: state.totals.processed + appIds.length,
      steamOk: state.totals.steamOk + steamOk,
      steamNotFound: state.totals.steamNotFound + steamNotFound,
      httpErrors: state.totals.httpErrors + httpErrors,
    },
  };
  await saveSteamSeedState(s3, bucket, stateKey, state);

  return { seedPrefix, stateBefore, stateAfter: state, wroteBatchKey: wroteKey, done: false, reason: "batch_written" };
}
