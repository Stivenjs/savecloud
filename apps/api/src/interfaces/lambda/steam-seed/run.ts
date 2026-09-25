import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { createHash } from "crypto";
import type { BatchLineV1, SteamSeedStateV1 } from "@interfaces/lambda/steam-seed/types";
import {
  batchKey,
  DEFAULT_STEAM_FILTERS,
  STEAM_SEED_PRIORITY_KEY,
  STEAM_SEED_STATE_KEY,
} from "@interfaces/lambda/steam-seed/layout";
import { processWithConcurrencyLimit } from "@interfaces/lambda/steam-seed/concurrency";
import { collectAppIds, isStreamDone } from "@interfaces/lambda/steam-seed/cursor";
import { getManifestSignatureAndIndices, splitLines } from "@interfaces/lambda/steam-seed/manifest";
import { tryGetObjectText } from "@interfaces/lambda/steam-seed/s3";
import { fetchSteamAppDetails } from "@interfaces/lambda/steam-seed/steam";
import {
  loadSteamSeedState,
  saveSteamSeedState,
  loadProcessedAppIds,
  saveProcessedAppIds,
} from "@interfaces/lambda/steam-seed/state";
import { loadManifestLines, parseAppIdLine } from "@interfaces/lambda/steam-seed/manifest";

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

function prioritySignature(text: string | null): string | null {
  if (text === null) return null;
  return createHash("sha1").update(text).digest("hex");
}

function jitterMs(base: number): number {
  const spread = Math.max(1, Math.floor(base * 0.35));
  const min = Math.max(0, base - spread);
  const max = base + spread;
  return Math.floor(min + Math.random() * (max - min + 1));
}

type FetchWithRetryResult = {
  appId: number;
  fetchedAt: string;
  httpStatus: number;
  steamSuccess: boolean | null;
  data?: unknown;
  error?: string;
  rateLimited: boolean;
};

/**
 * Llamada a Steam con retry simple para 429 (backoff exponencial + jitter).
 */
async function fetchWithRetry(params: {
  appId: number;
  lang: string;
  filters: string;
  maxRetries429: number;
  retryBaseDelayMs: number;
}): Promise<FetchWithRetryResult> {
  const { appId, lang, filters, maxRetries429, retryBaseDelayMs } = params;
  let attempt = 0;

  while (true) {
    const res = await fetchSteamAppDetails(appId, lang, filters);
    const fetchedAt = new Date().toISOString();

    if (res.httpStatus !== 429) {
      return {
        appId,
        fetchedAt,
        httpStatus: res.httpStatus,
        steamSuccess: res.steamSuccess ?? null,
        data: res.data,
        error: res.error,
        rateLimited: false,
      };
    }

    if (attempt >= maxRetries429) {
      return {
        appId,
        fetchedAt,
        httpStatus: 429,
        steamSuccess: null,
        error: "rate_limited",
        rateLimited: true,
      };
    }

    const backoffMs = retryBaseDelayMs * 2 ** attempt;
    await sleep(jitterMs(backoffMs));
    attempt += 1;
  }
}

/**
 * Reconstruye la memoria histórica leyendo los manifiestos en S3 hasta el punto exacto
 * donde se encuentra el cursor actual. Esto evita repetir peticiones de ejecuciones
 * previas a la actualización del sistema.
 *
 * @param {S3Client} s3 Cliente de S3.
 * @param {string} bucket Nombre del bucket.
 * @param {string} seedPrefix Prefijo base.
 * @param {SteamSeedStateV1} state Estado actual con los cursores.
 * @param {string[] | null} priorityLines Líneas del archivo de prioridad.
 * @param {Set<number>} processedSet Set en memoria para inyectar los IDs recuperados.
 */
async function rebuildHistory(
  s3: S3Client,
  bucket: string,
  seedPrefix: string,
  state: SteamSeedStateV1,
  priorityLines: string[] | null,
  processedSet: Set<number>
): Promise<void> {
  // 1. Recuperar los juegos de prioridad (priority_appids.jsonl)
  if (priorityLines) {
    const limit = state.priorityDone ? priorityLines.length : state.priorityLine;
    for (let i = 0; i < limit; i++) {
      const id = parseAppIdLine(priorityLines[i] ?? "");
      if (id !== null) processedSet.add(id);
    }
  }

  // 2. Recuperar de los manifiestos (part-00000.txt, etc.)
  const manifestPrefix = `${seedPrefix}/`;
  const { indices } = await getManifestSignatureAndIndices(s3, bucket, manifestPrefix);

  for (const part of indices) {
    if (part > state.manifestPart) break; // Detenerse si pasamos el archivo actual

    const lines = await loadManifestLines(s3, bucket, manifestPrefix, part);
    if (!lines) continue;

    // Si es un archivo anterior, lo leemos todo. Si es el archivo actual, leemos hasta la línea del cursor.
    const limit = part === state.manifestPart ? state.manifestLine : lines.length;

    for (let i = 0; i < limit; i++) {
      const id = parseAppIdLine(lines[i] ?? "");
      if (id !== null) processedSet.add(id);
    }
  }
}

/**
 * Ejecuta un “tick” del worker para un `seedPrefix` concreto.
 * Implementa avance rápido por historial, detección dinámica de catálogos nuevos y auto-sanación.
 */
export async function runSteamSeedTick(params: { s3: S3Client; bucket: string; seedPrefix: string }): Promise<{
  seedPrefix: string;
  stateBefore: SteamSeedStateV1;
  stateAfter: SteamSeedStateV1;
  wroteBatchKey?: string;
  done: boolean;
  reason?: "backoff_active" | "no_manifest_parts" | "catalog_complete" | "batch_written";
  priorityChangedDetected?: boolean;
}> {
  const { s3, bucket, seedPrefix } = params;

  const delayMs = envInt("STEAM_DELAY_MS", 2000);
  const batchSize = envInt("STEAM_BATCH_SIZE", 8);
  const backoffMinutes = envInt("STEAM_BACKOFF_MINUTES", 30);
  const lang = envStr("STEAM_LANG", "spanish");
  const filters = envStr("STEAM_FILTERS", DEFAULT_STEAM_FILTERS);
  const maxConcurrency = envInt("STEAM_MAX_CONCURRENCY", 4);
  const retry429 = envInt("STEAM_429_RETRIES", 2);
  const retryBaseDelayMs = envInt("STEAM_429_BASE_DELAY_MS", 1500);

  const stateKey = `${seedPrefix}/${STEAM_SEED_STATE_KEY}`;
  const manifestPrefix = `${seedPrefix}/`;
  const priorityKey = `${seedPrefix}/${STEAM_SEED_PRIORITY_KEY}`;

  const stateBefore = await loadSteamSeedState(s3, bucket, stateKey);
  let state: SteamSeedStateV1 = { ...stateBefore };
  let priorityChangedDetected = false;

  if (state.backoffUntil) {
    const until = new Date(state.backoffUntil).getTime();
    if (Number.isFinite(until) && until > Date.now()) {
      return {
        seedPrefix,
        stateBefore,
        stateAfter: state,
        done: false,
        reason: "backoff_active",
        priorityChangedDetected,
      };
    }
  }

  const priorityText = await tryGetObjectText(s3, bucket, priorityKey);
  const priorityLines = priorityText === null ? null : splitLines(priorityText);
  const currentPrioritySignature = prioritySignature(priorityText);

  if (state.prioritySignature !== currentPrioritySignature) {
    priorityChangedDetected = true;
    state = {
      ...state,
      prioritySignature: currentPrioritySignature,
      priorityLine: 0,
      priorityDone: !priorityLines || priorityLines.length === 0,
    };
    await saveSteamSeedState(s3, bucket, stateKey, state);
  }

  const processedSet = await loadProcessedAppIds(s3, bucket, seedPrefix);

  // Si la diferencia entre lo que dice el estado y lo que hay en memoria es muy grande (> 1000),
  // reconstruimos el historial leyendo los manifiestos previos hasta la posición del cursor.
  if (state.totals.processed - processedSet.size > 1000) {
    console.log(
      `[Auto-Heal] Reconstruyendo memoria. Procesados según estado: ${state.totals.processed}. En Set: ${processedSet.size}`
    );
    await rebuildHistory(s3, bucket, seedPrefix, state, priorityLines, processedSet);
    await saveProcessedAppIds(s3, bucket, seedPrefix, processedSet);
    console.log(`[Auto-Heal] Memoria reconstruida exitosamente. Total recuperado: ${processedSet.size} IDs.`);
  }

  // 1. Detección de Cambios en Manifiestos
  const { indices: partIndices, signature: currentManifestSig } = await getManifestSignatureAndIndices(
    s3,
    bucket,
    manifestPrefix
  );

  if (partIndices.length === 0) {
    return {
      seedPrefix,
      stateBefore,
      stateAfter: state,
      done: true,
      reason: "no_manifest_parts",
      priorityChangedDetected,
    };
  }

  // Lógica de migración segura para proteger el progreso actual
  if (state.manifestSignature === undefined || state.manifestSignature === null) {
    // Si la firma es null (estado en vivo actual), la actualizamos sin reiniciar el cursor.
    state = { ...state, manifestSignature: currentManifestSig };
  } else if (state.manifestSignature !== currentManifestSig) {
    // El cliente reemplazó los manifiestos, reiniciamos el cursor de forma segura.
    state = {
      ...state,
      manifestSignature: currentManifestSig,
      manifestPart: partIndices.length > 0 ? partIndices[0] : 0,
      manifestLine: 0,
      catalogComplete: false,
    };
  }

  // 2. Cargar la Memoria Histórica en el colector (Fast-Forward)
  const done = await isStreamDone(s3, bucket, seedPrefix, state, priorityLines, partIndices, processedSet);
  if (done) {
    if (!state.catalogComplete) {
      state = { ...state, catalogComplete: true };
      await saveSteamSeedState(s3, bucket, stateKey, state);
    }
    return {
      seedPrefix,
      stateBefore,
      stateAfter: state,
      done: true,
      reason: "catalog_complete",
      priorityChangedDetected,
    };
  }

  const { appIds, stateAfter } = await collectAppIds(
    s3,
    bucket,
    seedPrefix,
    state,
    priorityLines,
    partIndices,
    batchSize,
    processedSet
  );
  if (appIds.length === 0) {
    return { seedPrefix, stateBefore, stateAfter: state, done: true, priorityChangedDetected };
  }

  const lines: string[] = [];
  let steamOk = 0;
  let steamNotFound = 0;
  let httpErrors = 0;
  let sawRateLimit = false;
  let newlyProcessedCount = 0;

  const results = await processWithConcurrencyLimit(appIds, maxConcurrency, async (appId) => {
    await sleep(jitterMs(delayMs));
    return fetchWithRetry({ appId, lang, filters, maxRetries429: retry429, retryBaseDelayMs });
  });

  for (const r of results) {
    if (r.rateLimited) {
      sawRateLimit = true;
      httpErrors += 1;
      const line: BatchLineV1 = {
        appId: r.appId,
        fetchedAt: r.fetchedAt,
        httpStatus: r.httpStatus,
        steamSuccess: null,
        error: r.error ?? "rate_limited",
      };
      lines.push(JSON.stringify(line));
      continue;
    }

    if (r.steamSuccess === true) {
      steamOk += 1;
      processedSet.add(r.appId);
      newlyProcessedCount += 1;
      const line: BatchLineV1 = {
        appId: r.appId,
        fetchedAt: r.fetchedAt,
        httpStatus: r.httpStatus,
        steamSuccess: true,
        data: r.data,
      };
      lines.push(JSON.stringify(line));
    } else if (r.steamSuccess === false) {
      steamNotFound += 1;
      processedSet.add(r.appId);
      newlyProcessedCount += 1;
      const line: BatchLineV1 = {
        appId: r.appId,
        fetchedAt: r.fetchedAt,
        httpStatus: r.httpStatus,
        steamSuccess: false,
      };
      lines.push(JSON.stringify(line));
    } else {
      httpErrors += 1;
      const line: BatchLineV1 = {
        appId: r.appId,
        fetchedAt: r.fetchedAt,
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

  // 3. Persistir tolerancia a fallos y actualizar estado
  if (newlyProcessedCount > 0) {
    await saveProcessedAppIds(s3, bucket, seedPrefix, processedSet);
  }

  state = {
    ...stateAfter,
    batchSeq: state.batchSeq + 1,
    backoffUntil: sawRateLimit ? new Date(Date.now() + backoffMinutes * 60_000).toISOString() : null,
    totals: {
      processed: state.totals.processed + appIds.length,
      steamOk: state.totals.steamOk + steamOk,
      steamNotFound: state.totals.steamNotFound + steamNotFound,
      httpErrors: state.totals.httpErrors + httpErrors,
    },
  };
  await saveSteamSeedState(s3, bucket, stateKey, state);

  return {
    seedPrefix,
    stateBefore,
    stateAfter: state,
    wroteBatchKey: wroteKey,
    done: false,
    reason: "batch_written",
    priorityChangedDetected,
  };
}
