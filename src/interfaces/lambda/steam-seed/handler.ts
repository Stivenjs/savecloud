import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Context } from "aws-lambda";
import { Readable } from "stream";
import {
  batchKey,
  DEFAULT_STEAM_FILTERS,
  manifestPartKey,
  STEAM_SEED_MANIFEST_PREFIX,
  STEAM_SEED_MANIFEST_SUFFIX,
  STEAM_SEED_PRIORITY_KEY,
  STEAM_SEED_STATE_KEY,
} from "@interfaces/lambda/steam-seed/layout";
import type { BatchLineV1, SteamSeedStateV1 } from "@interfaces/lambda/steam-seed/types";

function defaultState(): SteamSeedStateV1 {
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isNoSuchKey(e: unknown): boolean {
  return typeof e === "object" && e !== null && "name" in e && (e as { name: string }).name === "NoSuchKey";
}

async function streamToString(body: unknown): Promise<string> {
  if (body === undefined || body === null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  return "";
}

function parseAppIdLine(line: string): number | null {
  const t = line.trim();
  if (!t || t.startsWith("#")) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

async function loadState(s3: S3Client, bucket: string, key: string): Promise<SteamSeedStateV1> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const raw = await streamToString(out.Body);
    const parsed = JSON.parse(raw) as SteamSeedStateV1;
    if (parsed?.version !== 1) return defaultState();
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      totals: { ...base.totals, ...parsed.totals },
    };
  } catch (e) {
    if (isNoSuchKey(e)) return defaultState();
    throw e;
  }
}

async function saveState(s3: S3Client, bucket: string, key: string, state: SteamSeedStateV1): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(state),
      ContentType: "application/json",
    })
  );
}

async function tryGetText(s3: S3Client, bucket: string, key: string): Promise<string | null> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return streamToString(out.Body);
  } catch (e) {
    if (isNoSuchKey(e)) return null;
    throw e;
  }
}

async function listManifestPartIndices(s3: S3Client, bucket: string, manifestPrefix: string): Promise<number[]> {
  const indices: number[] = [];
  let token: string | undefined;
  const fullPrefix = `${manifestPrefix}${STEAM_SEED_MANIFEST_PREFIX}`;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: fullPrefix,
        ContinuationToken: token,
      })
    );
    for (const obj of out.Contents ?? []) {
      const k = obj.Key ?? "";
      if (!k.endsWith(STEAM_SEED_MANIFEST_SUFFIX)) continue;
      const base = k.slice(fullPrefix.length, k.length - STEAM_SEED_MANIFEST_SUFFIX.length);
      const n = Number.parseInt(base, 10);
      if (Number.isFinite(n)) indices.push(n);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  indices.sort((a, b) => a - b);
  return indices;
}

async function loadManifestLines(
  s3: S3Client,
  bucket: string,
  manifestPrefix: string,
  partIndex: number
): Promise<string[] | null> {
  const key = `${manifestPrefix}${manifestPartKey(partIndex)}`;
  const text = await tryGetText(s3, bucket, key);
  if (text === null) return null;
  return splitLines(text);
}

type FetchResult = {
  httpStatus: number;
  steamSuccess: boolean | null;
  data?: unknown;
  error?: string;
};

async function fetchSteamAppDetails(appId: number, lang: string, filters: string): Promise<FetchResult> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=${encodeURIComponent(lang)}&filters=${encodeURIComponent(filters)}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  const status = res.status;
  if (status === 429) {
    return { httpStatus: status, steamSuccess: null, error: "rate_limited" };
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return {
      httpStatus: status,
      steamSuccess: null,
      error: t.slice(0, 500) || `http_${status}`,
    };
  }
  const bodyText = await res.text();
  if (!bodyText.trim() || bodyText === "null") {
    return { httpStatus: status, steamSuccess: null, error: "empty_body" };
  }
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    return { httpStatus: status, steamSuccess: null, error: "json_parse" };
  }
  const sid = String(appId);
  const entry = root[sid] as Record<string, unknown> | undefined;
  const success = Boolean(entry?.success);
  if (!success) {
    return { httpStatus: status, steamSuccess: false };
  }
  return { httpStatus: status, steamSuccess: true, data: entry?.data };
}

/**
 * Consume exactamente `limit` appids válidos desde `state` (prioridad, luego manifest por shards).
 */
async function takeUpToNAppIds(params: {
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
      if (cursor.priorityLine >= priorityLines.length) {
        cursor.priorityDone = true;
      }
      if (took >= limit) break;
    } else {
      cursor.priorityDone = true;
    }

    if (lines === null) {
      break;
    }

    while (cursor.manifestLine < lines.length && took < limit) {
      const id = parseAppIdLine(lines[cursor.manifestLine] ?? "");
      cursor.manifestLine += 1;
      if (id !== null) took += 1;
    }

    if (took >= limit) break;

    if (cursor.manifestLine >= lines.length) {
      const idx = partIndices.indexOf(cursor.manifestPart);
      const nextPart = idx >= 0 && idx + 1 < partIndices.length ? partIndices[idx + 1]! : null;
      if (nextPart === null) {
        break;
      }
      cursor.manifestPart = nextPart;
      cursor.manifestLine = 0;
      lines = await loadManifestLines(s3, bucket, manifestPrefix, cursor.manifestPart);
    }
  }

  return { stateAfter: cursor, took };
}

async function collectAppIds(
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
      if (cursor.priorityLine >= priorityLines.length) {
        cursor.priorityDone = true;
      }
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

async function isStreamDone(
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

export async function handler(_event: unknown, context: Context): Promise<Record<string, unknown>> {
  const bucket = process.env.BUCKET_NAME?.trim();
  if (!bucket) {
    return { ok: false, error: "BUCKET_NAME missing" };
  }

  const seedPrefix = (process.env.STEAM_SEED_PREFIX ?? "steam-seed").replace(/\/$/, "");
  const manifestPrefix = `${seedPrefix}/`;
  const stateKey = `${seedPrefix}/${STEAM_SEED_STATE_KEY}`;
  const priorityKey = `${seedPrefix}/${STEAM_SEED_PRIORITY_KEY}`;

  const lang = process.env.STEAM_LANG ?? "english";
  const filters = process.env.STEAM_FILTERS ?? DEFAULT_STEAM_FILTERS;
  const delayMs = envInt("STEAM_DELAY_MS", 2000);
  const batchSize = envInt("STEAM_BATCH_SIZE", 8);
  const backoffMinutes = envInt("STEAM_BACKOFF_MINUTES", 30);

  const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-2" });

  let state = await loadState(s3, bucket, stateKey);

  if (state.catalogComplete) {
    return { ok: true, skipped: "catalog_complete" };
  }

  if (state.backoffUntil) {
    const until = Date.parse(state.backoffUntil);
    if (Number.isFinite(until) && Date.now() < until) {
      return { ok: true, skipped: "backoff", backoffUntil: state.backoffUntil };
    }
  }

  const partIndices = await listManifestPartIndices(s3, bucket, manifestPrefix);
  if (partIndices.length === 0) {
    return { ok: false, error: "no_manifest_parts", manifestPrefix };
  }

  if (!partIndices.includes(state.manifestPart)) {
    state = { ...state, manifestPart: partIndices[0]!, manifestLine: 0 };
  }

  let priorityLines: string[] | null = null;
  const priorityText = await tryGetText(s3, bucket, priorityKey);
  if (priorityText !== null && priorityText.trim().length > 0) {
    priorityLines = splitLines(priorityText);
  } else {
    state = { ...state, priorityDone: true };
  }

  const stateBefore: SteamSeedStateV1 = { ...state, totals: { ...state.totals } };

  const { appIds } = await collectAppIds(s3, bucket, seedPrefix, stateBefore, priorityLines, partIndices, batchSize);

  if (appIds.length === 0) {
    const done = await isStreamDone(s3, bucket, seedPrefix, stateBefore, priorityLines, partIndices);
    const next = { ...stateBefore, catalogComplete: done };
    await saveState(s3, bucket, stateKey, next);
    return { ok: true, message: "no_appids", catalogComplete: next.catalogComplete };
  }

  const batchLines: BatchLineV1[] = [];
  const minRemainingMs = 15_000;
  let totals = { ...stateBefore.totals };

  for (let i = 0; i < appIds.length; i++) {
    if (context.getRemainingTimeInMillis && context.getRemainingTimeInMillis() < minRemainingMs) {
      break;
    }

    const appId = appIds[i]!;
    const fr = await fetchSteamAppDetails(appId, lang, filters);
    const fetchedAt = new Date().toISOString();

    if (fr.httpStatus === 429) {
      const { stateAfter } = await takeUpToNAppIds({
        s3,
        bucket,
        seedPrefix,
        state: stateBefore,
        priorityLines,
        partIndices,
        limit: batchLines.length,
      });
      batchLines.push({
        appId,
        fetchedAt,
        httpStatus: fr.httpStatus,
        steamSuccess: null,
        error: fr.error,
      });
      const nextState: SteamSeedStateV1 = {
        ...stateAfter,
        batchSeq: stateBefore.batchSeq,
        totals,
        backoffUntil: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
        catalogComplete: false,
      };
      if (batchLines.length > 0) {
        const body = batchLines.map((l) => JSON.stringify(l)).join("\n") + "\n";
        const bKey = `${seedPrefix}/${batchKey(nextState.batchSeq)}`;
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: bKey,
            Body: body,
            ContentType: "application/x-ndjson",
          })
        );
        nextState.batchSeq = stateBefore.batchSeq + 1;
      }
      await saveState(s3, bucket, stateKey, nextState);
      return {
        ok: true,
        wroteBatchLines: batchLines.length,
        rateLimited: true,
        backoffUntil: nextState.backoffUntil,
        totals: nextState.totals,
      };
    }

    batchLines.push({
      appId,
      fetchedAt,
      httpStatus: fr.httpStatus,
      steamSuccess: fr.steamSuccess ?? null,
      data: fr.data,
      error: fr.error,
    });

    if (fr.steamSuccess === true) totals = { ...totals, steamOk: totals.steamOk + 1 };
    else if (fr.steamSuccess === false) totals = { ...totals, steamNotFound: totals.steamNotFound + 1 };
    else totals = { ...totals, httpErrors: totals.httpErrors + 1 };
    totals = { ...totals, processed: totals.processed + 1 };

    if (i < appIds.length - 1) {
      await sleep(delayMs);
    }
  }

  const processedCount = batchLines.length;
  const { stateAfter } = await takeUpToNAppIds({
    s3,
    bucket,
    seedPrefix,
    state: stateBefore,
    priorityLines,
    partIndices,
    limit: processedCount,
  });

  let nextState: SteamSeedStateV1 = {
    ...stateAfter,
    batchSeq: stateBefore.batchSeq,
    totals,
    backoffUntil: null,
  };

  if (batchLines.length > 0) {
    const body = batchLines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const bKey = `${seedPrefix}/${batchKey(nextState.batchSeq)}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: bKey,
        Body: body,
        ContentType: "application/x-ndjson",
      })
    );
    nextState.batchSeq = stateBefore.batchSeq + 1;
  }

  const noMore = await isStreamDone(s3, bucket, seedPrefix, nextState, priorityLines, partIndices);
  if (noMore) {
    nextState = { ...nextState, catalogComplete: true };
  }

  await saveState(s3, bucket, stateKey, nextState);

  return {
    ok: true,
    wroteBatchLines: batchLines.length,
    catalogComplete: nextState.catalogComplete,
    totals: nextState.totals,
  };
}
