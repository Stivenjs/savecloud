import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { ReviewsBatchLineV1, SteamReviewsStateV1 } from "@interfaces/lambda/steam-seed/types";
import { reviewsBatchKey } from "@interfaces/lambda/steam-seed/layout";
import { processWithConcurrencyLimit } from "@interfaces/lambda/steam-seed/concurrency";
import { loadProcessedAppIds } from "@interfaces/lambda/steam-seed/state";
import { fetchSteamReviews } from "@interfaces/lambda/steam-seed/steam_reviews";
import { loadReviewsState, saveReviewsState } from "@interfaces/lambda/steam-seed/reviews_state";

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

function jitterMs(base: number): number {
  const spread = Math.max(1, Math.floor(base * 0.35));
  const min = Math.max(0, base - spread);
  const max = base + spread;
  return Math.floor(min + Math.random() * (max - min + 1));
}

type FetchReviewsWithRetryResult = {
  appId: number;
  fetchedAt: string;
  httpStatus: number;
  reviewsSuccess: boolean | null;
  summary?: import("@interfaces/lambda/steam-seed/types").SteamReviewSummary;
  error?: string;
  rateLimited: boolean;
};

async function fetchWithRetry(params: {
  appId: number;
  lang: string;
  maxRetries429: number;
  retryBaseDelayMs: number;
}): Promise<FetchReviewsWithRetryResult> {
  const { appId, lang, maxRetries429, retryBaseDelayMs } = params;
  let attempt = 0;

  while (true) {
    const res = await fetchSteamReviews(appId, lang);
    const fetchedAt = new Date().toISOString();

    if (res.httpStatus !== 429) {
      return {
        appId,
        fetchedAt,
        httpStatus: res.httpStatus,
        reviewsSuccess: res.reviewsSuccess ?? null,
        summary: res.summary,
        error: res.error,
        rateLimited: false,
      };
    }

    if (attempt >= maxRetries429) {
      return { appId, fetchedAt, httpStatus: 429, reviewsSuccess: null, error: "rate_limited", rateLimited: true };
    }

    const backoffMs = retryBaseDelayMs * 2 ** attempt;
    await sleep(jitterMs(backoffMs));
    attempt += 1;
  }
}

export type RunReviewsTickResult = {
  seedPrefix: string;
  stateBefore: SteamReviewsStateV1;
  stateAfter: SteamReviewsStateV1;
  wroteBatchKey?: string;
  done: boolean;
  reason?: "backoff_active" | "no_processed_ids" | "pass_complete" | "batch_written";
};

/**
 * Ejecuta un "tick" del worker de reseñas para un `seedPrefix` concreto.
 *
 * Flujo:
 *  1. Cargar el estado del cursor de reseñas (independiente del estado principal).
 *  2. Respetar el backoff si un tick anterior recibió un rate-limit.
 *  3. Cargar `processed_appids.json` — la lista de IDs ya validados por el tick de detalles.
 *  4. Si no hay IDs procesados aún, retornar `reason: "no_processed_ids"`.
 *  5. Si el offset supera el total de IDs, reiniciarlo a 0 para una nueva pasada.
 *  6. Recolectar el siguiente slice de IDs según `offset` y `REVIEWS_BATCH_SIZE`.
 *  7. Obtener resúmenes de reseñas de forma concurrente con delay + jitter + retry en 429.
 *  8. Escribir un batch NDJSON en `{seedPrefix}/reviews/batches/{seq}.jsonl`.
 *  9. Persistir el estado del cursor actualizado.
 *
 * Variables de entorno consumidas (todas opcionales, con valores seguros por defecto):
 *  - REVIEWS_BATCH_SIZE        por defecto 25
 *  - REVIEWS_DELAY_MS          por defecto 600  (delay por petición)
 *  - REVIEWS_MAX_CONCURRENCY   por defecto 8
 *  - REVIEWS_BACKOFF_MINUTES   por defecto 15
 *  - REVIEWS_429_RETRIES       por defecto 3
 *  - REVIEWS_429_BASE_DELAY_MS por defecto 2000
 *  - STEAM_LANG                compartida con el pase principal (por defecto "spanish")
 */
export async function runReviewsTick(params: {
  s3: S3Client;
  bucket: string;
  seedPrefix: string;
}): Promise<RunReviewsTickResult> {
  const { s3, bucket, seedPrefix } = params;

  const batchSize = envInt("REVIEWS_BATCH_SIZE", 25);
  const delayMs = envInt("REVIEWS_DELAY_MS", 600);
  const maxConcurrency = envInt("REVIEWS_MAX_CONCURRENCY", 8);
  const backoffMinutes = envInt("REVIEWS_BACKOFF_MINUTES", 15);
  const retry429 = envInt("REVIEWS_429_RETRIES", 3);
  const retryBaseDelayMs = envInt("REVIEWS_429_BASE_DELAY_MS", 2000);
  const lang = envStr("STEAM_LANG", "spanish");

  const stateBefore = await loadReviewsState(s3, bucket, seedPrefix);
  let state: SteamReviewsStateV1 = { ...stateBefore };

  if (state.backoffUntil) {
    const until = new Date(state.backoffUntil).getTime();
    if (Number.isFinite(until) && until > Date.now()) {
      return { seedPrefix, stateBefore, stateAfter: state, done: false, reason: "backoff_active" };
    }

    state = { ...state, backoffUntil: null };
  }

  const processedSet = await loadProcessedAppIds(s3, bucket, seedPrefix);

  if (processedSet.size === 0) {
    return { seedPrefix, stateBefore, stateAfter: state, done: true, reason: "no_processed_ids" };
  }

  const allIds = Array.from(processedSet).sort((a, b) => a - b);

  if (state.offset >= allIds.length) {
    state = { ...state, offset: 0 };
    await saveReviewsState(s3, bucket, seedPrefix, state);
    return { seedPrefix, stateBefore, stateAfter: state, done: true, reason: "pass_complete" };
  }

  const appIds = allIds.slice(state.offset, state.offset + batchSize);

  const fetchResults = await processWithConcurrencyLimit(appIds, maxConcurrency, async (appId) => {
    await sleep(jitterMs(delayMs));
    return fetchWithRetry({ appId, lang, maxRetries429: retry429, retryBaseDelayMs });
  });

  const lines: string[] = [];
  let ok = 0;
  let notFound = 0;
  let httpErrors = 0;
  let sawRateLimit = false;

  for (const r of fetchResults) {
    if (r.rateLimited) {
      sawRateLimit = true;
      httpErrors += 1;
      const line: ReviewsBatchLineV1 = {
        appId: r.appId,
        fetchedAt: r.fetchedAt,
        httpStatus: r.httpStatus,
        reviewsSuccess: null,
        error: "rate_limited",
      };
      lines.push(JSON.stringify(line));
      continue;
    }

    if (r.reviewsSuccess === true) {
      ok += 1;
      const line: ReviewsBatchLineV1 = {
        appId: r.appId,
        fetchedAt: r.fetchedAt,
        httpStatus: r.httpStatus,
        reviewsSuccess: true,
        summary: r.summary,
      };
      lines.push(JSON.stringify(line));
    } else if (r.reviewsSuccess === false) {
      notFound += 1;
      const line: ReviewsBatchLineV1 = {
        appId: r.appId,
        fetchedAt: r.fetchedAt,
        httpStatus: r.httpStatus,
        reviewsSuccess: false,
      };
      lines.push(JSON.stringify(line));
    } else {
      httpErrors += 1;
      const line: ReviewsBatchLineV1 = {
        appId: r.appId,
        fetchedAt: r.fetchedAt,
        httpStatus: r.httpStatus,
        reviewsSuccess: null,
        error: r.error ?? "http_error",
      };
      lines.push(JSON.stringify(line));
    }
  }

  const wroteKey = `${seedPrefix}/${reviewsBatchKey(state.batchSeq)}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: wroteKey,
      Body: lines.join("\n") + "\n",
      ContentType: "application/x-ndjson",
    })
  );

  state = {
    ...state,
    offset: state.offset + appIds.length,
    batchSeq: state.batchSeq + 1,
    backoffUntil: sawRateLimit ? new Date(Date.now() + backoffMinutes * 60_000).toISOString() : null,
    totals: {
      processed: state.totals.processed + appIds.length,
      ok: state.totals.ok + ok,
      notFound: state.totals.notFound + notFound,
      httpErrors: state.totals.httpErrors + httpErrors,
    },
  };
  await saveReviewsState(s3, bucket, seedPrefix, state);

  return {
    seedPrefix,
    stateBefore,
    stateAfter: state,
    wroteBatchKey: wroteKey,
    done: false,
    reason: "batch_written",
  };
}
