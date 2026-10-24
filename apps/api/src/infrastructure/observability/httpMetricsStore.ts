/**
 * Métricas HTTP en memoria (proceso Fastify de larga duración).
 * En Lambda fría el buffer se vacía por invocación; sigue sirviendo en `bun --watch server.ts`.
 */

export const OBSERVABILITY_WINDOWS = ["5m", "15m", "1h", "24h"] as const;
export type ObservabilityWindow = (typeof OBSERVABILITY_WINDOWS)[number];

export interface HttpMetricsSample {
  ts: number;
  method: string;
  /** Path observado tal cual llegó (sin query). Para histogramas de URL. */
  path: string;
  /** Plantilla de ruta (ej: "/saves/:id") cuando Fastify la expone. Más estable para agregar. */
  routeUrl?: string | null;
  statusCode: number;
  durationMs: number;
}

const MAX_SAMPLES = 2500;
const samples: HttpMetricsSample[] = [];
let ringStart = 0;
let ringCount = 0;
const COUNTER_BUCKET_MS = 10_000;
const COUNTER_BUCKET_COUNT = (24 * 60 * 60 * 1000) / COUNTER_BUCKET_MS;

interface CountEntry {
  requests: number;
  errors: number;
}

interface RouteCountEntry extends CountEntry {
  statuses: Map<number, number>;
}

interface RequestCountBucket {
  startMs: number;
  firstRequestAtMs: number;
  lastRequestAtMs: number;
  total: CountEntry;
  byScope: Record<MetricsScope, CountEntry>;
  byMethod: Map<string, CountEntry>;
  byRoute: Map<string, RouteCountEntry>;
  byStatus: Map<number, number>;
}

interface WindowCounters {
  requests: number;
  errors: number;
  oldestRequestAtMs: number | null;
  newestRequestAtMs: number | null;
  byScope: Record<MetricsScope, CountEntry>;
  byMethod: Map<string, CountEntry>;
  byRoute: Map<string, RouteCountEntry>;
  byStatus: Map<number, number>;
}

const counterBuckets: Array<RequestCountBucket | undefined> = new Array(COUNTER_BUCKET_COUNT);

/** Expone un reinicio del almacén para las pruebas. */
export function resetHttpMetricsForTests(): void {
  samples.length = 0;
  ringStart = 0;
  ringCount = 0;
  counterBuckets.fill(undefined);
}

function createCountEntry(): CountEntry {
  return { requests: 0, errors: 0 };
}

function incrementCount(entry: CountEntry, isError: boolean): void {
  entry.requests += 1;
  if (isError) entry.errors += 1;
}

function getRequestCountBucket(ts: number): RequestCountBucket {
  const startMs = Math.floor(ts / COUNTER_BUCKET_MS) * COUNTER_BUCKET_MS;
  const index = Math.floor(startMs / COUNTER_BUCKET_MS) % COUNTER_BUCKET_COUNT;
  const existing = counterBuckets[index];
  if (existing?.startMs === startMs) return existing;

  const bucket: RequestCountBucket = {
    startMs,
    firstRequestAtMs: ts,
    lastRequestAtMs: ts,
    total: createCountEntry(),
    byScope: {
      saves: createCountEntry(),
      notifications: createCountEntry(),
      other: createCountEntry(),
    },
    byMethod: new Map(),
    byRoute: new Map(),
    byStatus: new Map(),
  };
  counterBuckets[index] = bucket;
  return bucket;
}

function incrementMapEntry<T extends CountEntry>(
  entries: Map<string, T>,
  key: string,
  isError: boolean,
  create: () => T
): T {
  let entry = entries.get(key);
  if (!entry) {
    entry = create();
    entries.set(key, entry);
  }
  incrementCount(entry, isError);
  return entry;
}

function recordRequestCount(sample: HttpMetricsSample): void {
  const bucket = getRequestCountBucket(sample.ts);
  const isError = sample.statusCode >= 400;
  const method = (sample.method || "GET").toUpperCase();
  const route = effectiveRoute(sample);

  bucket.firstRequestAtMs = Math.min(bucket.firstRequestAtMs, sample.ts);
  bucket.lastRequestAtMs = Math.max(bucket.lastRequestAtMs, sample.ts);
  incrementCount(bucket.total, isError);
  incrementCount(bucket.byScope[classifyPath(sample.path)], isError);
  incrementMapEntry(bucket.byMethod, method, isError, createCountEntry);

  const routeEntry = incrementMapEntry(bucket.byRoute, route, isError, () => ({
    ...createCountEntry(),
    statuses: new Map<number, number>(),
  }));
  routeEntry.statuses.set(sample.statusCode, (routeEntry.statuses.get(sample.statusCode) ?? 0) + 1);
  bucket.byStatus.set(sample.statusCode, (bucket.byStatus.get(sample.statusCode) ?? 0) + 1);
}

export function recordHttpMetric(entry: Omit<HttpMetricsSample, "ts">): void {
  const sample: HttpMetricsSample = { ...entry, ts: Date.now() };

  // CloudWatch extrae estas métricas estructuradas de los registros de Lambda.
  // En local se conserva el búfer usado por el panel de desarrollo.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // Las rutas desconocidas comparten una dimensión para limitar la cardinalidad.
    const route = entry.routeUrl?.trim() || "/unmatched";
    console.log(
      JSON.stringify({
        _aws: {
          Timestamp: sample.ts,
          CloudWatchMetrics: [
            {
              Namespace: "SaveCloud/API",
              Dimensions: [["Route", "Method"]],
              Metrics: [
                { Name: "RequestCount", Unit: "Count" },
                { Name: "ErrorCount", Unit: "Count" },
                { Name: "LatencyMs", Unit: "Milliseconds" },
              ],
            },
          ],
        },
        Route: route,
        Method: entry.method.toUpperCase(),
        RequestCount: 1,
        ErrorCount: entry.statusCode >= 400 ? 1 : 0,
        LatencyMs: entry.durationMs,
      })
    );
  }

  recordRequestCount(sample);

  if (ringCount < MAX_SAMPLES) {
    samples.push(sample);
    ringCount += 1;
    return;
  }

  samples[ringStart] = sample;
  ringStart = (ringStart + 1) % MAX_SAMPLES;
}

function snapshotSamples(): HttpMetricsSample[] {
  if (ringCount === 0) return [];
  if (ringCount < MAX_SAMPLES || ringStart === 0) return samples.slice(0, ringCount);

  const out = new Array<HttpMetricsSample>(ringCount);
  let cursor = ringStart;
  for (let i = 0; i < ringCount; i++) {
    out[i] = samples[cursor] as HttpMetricsSample;
    cursor = (cursor + 1) % MAX_SAMPLES;
  }
  return out;
}

function createWindowCounters(): WindowCounters {
  return {
    requests: 0,
    errors: 0,
    oldestRequestAtMs: null,
    newestRequestAtMs: null,
    byScope: {
      saves: createCountEntry(),
      notifications: createCountEntry(),
      other: createCountEntry(),
    },
    byMethod: new Map(),
    byRoute: new Map(),
    byStatus: new Map(),
  };
}

function addCountEntry(target: CountEntry, source: CountEntry): void {
  target.requests += source.requests;
  target.errors += source.errors;
}

function summarizeCounters(buckets: RequestCountBucket[]): WindowCounters {
  const summary = createWindowCounters();

  for (const bucket of buckets) {
    summary.requests += bucket.total.requests;
    summary.errors += bucket.total.errors;
    summary.oldestRequestAtMs =
      summary.oldestRequestAtMs == null
        ? bucket.firstRequestAtMs
        : Math.min(summary.oldestRequestAtMs, bucket.firstRequestAtMs);
    summary.newestRequestAtMs =
      summary.newestRequestAtMs == null
        ? bucket.lastRequestAtMs
        : Math.max(summary.newestRequestAtMs, bucket.lastRequestAtMs);

    for (const scope of ["saves", "notifications", "other"] as const) {
      addCountEntry(summary.byScope[scope], bucket.byScope[scope]);
    }

    for (const [method, source] of bucket.byMethod) {
      const target = summary.byMethod.get(method) ?? createCountEntry();
      addCountEntry(target, source);
      summary.byMethod.set(method, target);
    }

    for (const [route, source] of bucket.byRoute) {
      let target = summary.byRoute.get(route);
      if (!target) {
        target = { ...createCountEntry(), statuses: new Map<number, number>() };
        summary.byRoute.set(route, target);
      }
      addCountEntry(target, source);
      for (const [status, count] of source.statuses) {
        target.statuses.set(status, (target.statuses.get(status) ?? 0) + count);
      }
    }

    for (const [status, count] of bucket.byStatus) {
      summary.byStatus.set(status, (summary.byStatus.get(status) ?? 0) + count);
    }
  }

  return summary;
}

function getCounterBuckets(cutoff: number, now: number): RequestCountBucket[] {
  return counterBuckets.filter(
    (bucket): bucket is RequestCountBucket =>
      bucket != null && bucket.startMs <= now && bucket.startMs + COUNTER_BUCKET_MS > cutoff
  );
}

export function windowParamToMs(window: string): number {
  switch (window) {
    case "5m":
      return 5 * 60 * 1000;
    case "15m":
      return 15 * 60 * 1000;
    case "1h":
      return 60 * 60 * 1000;
    case "24h":
      return 24 * 60 * 60 * 1000;
    default:
      return 15 * 60 * 1000;
  }
}

export type MetricsScope = "saves" | "notifications" | "other";

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX24 = /^[0-9a-f]{24}$/i;
const ONLY_DIGITS = /^\d+$/;

/** Normaliza un path real a una plantilla aproximada cuando Fastify no provee la ruta. */
function normalizeFallbackPath(rawPath: string): string {
  const cleaned = rawPath.split("?")[0] ?? "";
  if (!cleaned.startsWith("/")) return cleaned;
  return cleaned
    .split("/")
    .map((seg) => {
      if (!seg) return seg;
      if (UUID_LIKE.test(seg) || HEX24.test(seg)) return ":id";
      if (ONLY_DIGITS.test(seg) && seg.length > 1) return ":n";
      return seg;
    })
    .join("/");
}

function effectiveRoute(s: HttpMetricsSample): string {
  const r = s.routeUrl?.trim();
  if (r) return r;
  return normalizeFallbackPath(s.path);
}

export function classifyPath(path: string): MetricsScope {
  const p = path.split("?")[0] ?? "";
  if (p === "/observability/desktop/summary" || p.startsWith("/observability/")) {
    return "other";
  }
  if (p.startsWith("/saves")) return "saves";
  if (p.startsWith("/notifications")) return "notifications";
  return "other";
}

export function reasonCodeFromStatus(statusCode: number): string {
  if (statusCode === 401 || statusCode === 403) return "unauthorized";
  if (statusCode === 429) return "rate_limited";
  if (statusCode >= 500) return "server_error";
  if (statusCode >= 400) return "client_error";
  return "ok";
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0] ?? null;
  const rank = Math.round(p * (sorted.length - 1));
  const idx = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[idx] ?? null;
}

export interface ScopeSummaryDto {
  requests: number;
  errors: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface ReasonCodeCountDto {
  reasonCode: string;
  count: number;
}

export interface PathLatencyEntryDto {
  route: string;
  requests: number;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface PathErrorEntryDto {
  route: string;
  errors: number;
  errorRate: number;
  topStatus: number | null;
}

export interface MetricsBucketDto {
  /** Fin del bucket en epoch ms (incluido). */
  tsEndMs: number;
  requests: number;
  errors: number;
  p95Ms: number | null;
}

export interface CoverageDto {
  /** Mediciones de latencia consideradas en la ventana. */
  samplesInWindow: number;
  /** Solicitudes contabilizadas en la ventana, sin límite de muestras de latencia. */
  requestsInWindow: number;
  /** Mediciones de latencia retenidas y consideradas para percentiles. */
  latencySamplesInWindow: number;
  oldestSampleAtMs: number | null;
  newestSampleAtMs: number | null;
  /** Capacidad del búfer acotado usado para percentiles de latencia. */
  retentionLimit: number;
  /** Mediciones de latencia retenidas globalmente, todas las ventanas. */
  retainedSamples: number;
  /** Duración de cada intervalo de agregación exacta. */
  counterBucketMs: number;
}

export interface ObservabilityAlertItemDto {
  id: string;
  userId: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  status?: string | null;
  reasonCode?: string | null;
  payloadJson?: string | null;
  createdAt: string;
  updatedAt: string;
  syncVersion: number;
}

export interface ObservabilitySummaryDto {
  generatedAt: string;
  window: string;
  websocket?: {
    activeConnections: number | null;
    scope: "api_process" | "unavailable";
  };
  totals: {
    requests: number;
    errors: number;
    errorRate: number;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    rpsAvg: number;
  };
  byScope: Record<MetricsScope, ScopeSummaryDto> & { ws: { note: string; requests: number; errors: number } };
  byMethod: Record<string, { requests: number; errors: number; p95Ms: number | null }>;
  statusBreakdown: {
    classes: Record<"1xx" | "2xx" | "3xx" | "4xx" | "5xx", number>;
    granular: Array<{ statusCode: number; count: number }>;
  };
  topSlowPaths: PathLatencyEntryDto[];
  topErrorPaths: PathErrorEntryDto[];
  topReasonCodes: ReasonCodeCountDto[];
  buckets: MetricsBucketDto[];
  coverage: CoverageDto;
  items: ObservabilityAlertItemDto[];
  unreadCount: number;
}

function emptyScope(): ScopeSummaryDto {
  return { requests: 0, errors: 0, p50Ms: null, p95Ms: null, p99Ms: null };
}

function reduceScope(rows: HttpMetricsSample[], counts: CountEntry): ScopeSummaryDto {
  if (counts.requests === 0) return emptyScope();
  const okDurations = rows.filter((r) => r.statusCode < 400).map((r) => r.durationMs);
  okDurations.sort((a, b) => a - b);
  return {
    requests: counts.requests,
    errors: counts.errors,
    p50Ms: percentile(okDurations, 0.5),
    p95Ms: percentile(okDurations, 0.95),
    p99Ms: percentile(okDurations, 0.99),
  };
}

function buildBuckets(
  rows: HttpMetricsSample[],
  countBuckets: RequestCountBucket[],
  windowMs: number,
  now: number
): MetricsBucketDto[] {
  const BUCKET_COUNT = 30;
  const bucketMs = Math.max(1, Math.floor(windowMs / BUCKET_COUNT));
  const start = now - windowMs;
  const buckets: MetricsBucketDto[] = Array.from({ length: BUCKET_COUNT }, (_, i) => ({
    tsEndMs: start + bucketMs * (i + 1),
    requests: 0,
    errors: 0,
    p95Ms: null,
  }));
  const okPerBucket: number[][] = Array.from({ length: BUCKET_COUNT }, () => []);
  for (const r of rows) {
    const idx = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor((r.ts - start) / bucketMs)));
    const slot = buckets[idx];
    if (!slot) continue;
    if (r.statusCode < 400) {
      const arr = okPerBucket[idx];
      if (arr) arr.push(r.durationMs);
    }
  }
  for (const countBucket of countBuckets) {
    const idx = Math.min(
      BUCKET_COUNT - 1,
      Math.max(0, Math.floor((countBucket.startMs - start) / bucketMs))
    );
    const slot = buckets[idx];
    if (!slot) continue;
    slot.requests += countBucket.total.requests;
    slot.errors += countBucket.total.errors;
  }
  for (let i = 0; i < BUCKET_COUNT; i++) {
    const arr = okPerBucket[i];
    const slot = buckets[i];
    if (!arr || !slot) continue;
    if (arr.length === 0) continue;
    arr.sort((a, b) => a - b);
    slot.p95Ms = percentile(arr, 0.95);
  }
  return buckets;
}

function buildTopSlowPaths(
  rows: HttpMetricsSample[],
  routeCounts: Map<string, RouteCountEntry>
): PathLatencyEntryDto[] {
  const grouped = new Map<string, number[]>();
  for (const r of rows) {
    if (r.statusCode >= 400) continue;
    const key = effectiveRoute(r);
    let arr = grouped.get(key);
    if (!arr) {
      arr = [];
      grouped.set(key, arr);
    }
    arr.push(r.durationMs);
  }
  const out: PathLatencyEntryDto[] = [];
  for (const [route, counts] of routeCounts.entries()) {
    if (counts.requests < 3) continue;
    const arr = grouped.get(route) ?? [];
    arr.sort((a, b) => a - b);
    out.push({
      route,
      requests: counts.requests,
      p95Ms: percentile(arr, 0.95),
      p99Ms: percentile(arr, 0.99),
    });
  }
  out.sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));
  return out.slice(0, 5);
}

function buildTopErrorPaths(routeCounts: Map<string, RouteCountEntry>): PathErrorEntryDto[] {
  const out: PathErrorEntryDto[] = [];
  for (const [route, agg] of routeCounts.entries()) {
    if (agg.errors === 0) continue;
    let topStatus: number | null = null;
    let topCount = -1;
    for (const [code, c] of agg.statuses.entries()) {
      if (c > topCount) {
        topStatus = code;
        topCount = c;
      }
    }
    out.push({
      route,
      errors: agg.errors,
      errorRate: agg.requests > 0 ? agg.errors / agg.requests : 0,
      topStatus,
    });
  }
  out.sort((a, b) => b.errors - a.errors);
  return out.slice(0, 5);
}

function buildStatusBreakdown(byStatus: Map<number, number>): ObservabilitySummaryDto["statusBreakdown"] {
  const classes: Record<"1xx" | "2xx" | "3xx" | "4xx" | "5xx", number> = {
    "1xx": 0,
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
  };
  for (const [code, count] of byStatus) {
    if (code >= 100 && code < 200) classes["1xx"] += count;
    else if (code >= 200 && code < 300) classes["2xx"] += count;
    else if (code >= 300 && code < 400) classes["3xx"] += count;
    else if (code >= 400 && code < 500) classes["4xx"] += count;
    else if (code >= 500 && code < 600) classes["5xx"] += count;
  }
  const granularArr = [...byStatus.entries()]
    .map(([statusCode, count]) => ({ statusCode, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return { classes, granular: granularArr };
}

function buildByMethod(
  rows: HttpMetricsSample[],
  methodCounts: Map<string, CountEntry>
): ObservabilitySummaryDto["byMethod"] {
  const grouped = new Map<string, number[]>();
  for (const r of rows) {
    const m = (r.method || "GET").toUpperCase();
    if (r.statusCode >= 400) continue;
    const durations = grouped.get(m) ?? [];
    durations.push(r.durationMs);
    grouped.set(m, durations);
  }
  const out: ObservabilitySummaryDto["byMethod"] = {};
  for (const [method, counts] of methodCounts.entries()) {
    const durations = grouped.get(method) ?? [];
    durations.sort((a, b) => a - b);
    out[method] = {
      requests: counts.requests,
      errors: counts.errors,
      p95Ms: percentile(durations, 0.95),
    };
  }
  return out;
}

export function summarizeHttpMetrics(windowParam: string): ObservabilitySummaryDto {
  const window = OBSERVABILITY_WINDOWS.includes(windowParam as ObservabilityWindow) ? windowParam : "15m";
  const windowMs = windowParamToMs(window);
  const now = Date.now();
  const cutoff = now - windowMs;
  const rows = snapshotSamples().filter((sample) => sample.ts >= cutoff);
  const countBuckets = getCounterBuckets(cutoff, now);
  const counters = summarizeCounters(countBuckets);

  const byPathScope = {
    saves: rows.filter((r) => classifyPath(r.path) === "saves"),
    notifications: rows.filter((r) => classifyPath(r.path) === "notifications"),
    other: rows.filter((r) => classifyPath(r.path) === "other"),
  };

  const savesSummary = reduceScope(byPathScope.saves, counters.byScope.saves);
  const notificationsSummary = reduceScope(byPathScope.notifications, counters.byScope.notifications);
  const otherSummary = reduceScope(byPathScope.other, counters.byScope.other);

  const totalsN = counters.requests;
  const totalsErrors = counters.errors;
  const okAll = rows.filter((row) => row.statusCode < 400).map((row) => row.durationMs);
  okAll.sort((a, b) => a - b);

  const reasonMap = new Map<string, number>();
  for (const [statusCode, count] of counters.byStatus) {
    if (statusCode < 400) continue;
    const reasonCode = reasonCodeFromStatus(statusCode);
    reasonMap.set(reasonCode, (reasonMap.get(reasonCode) ?? 0) + count);
  }
  const topReasonCodes = [...reasonMap.entries()]
    .map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const items: ObservabilityAlertItemDto[] = [];
  if (savesSummary.p95Ms != null && savesSummary.p95Ms > 2000 && savesSummary.requests >= 5) {
    const iso = new Date().toISOString();
    items.push({
      id: `obs_high_latency_${Date.now()}`,
      userId: "system",
      kind: "desktop_observability",
      severity: "warning",
      title: "Latencia alta en rutas /saves",
      body: `P95 ~${Math.round(savesSummary.p95Ms)} ms en la ventana ${window}`,
      status: "degraded",
      reasonCode: "high_latency",
      payloadJson: JSON.stringify({ scope: "saves", p95Ms: savesSummary.p95Ms, window }),
      createdAt: iso,
      updatedAt: iso,
      syncVersion: 1,
    });
  }
  if (totalsN >= 10 && totalsErrors / totalsN > 0.15) {
    const iso = new Date().toISOString();
    items.push({
      id: `obs_error_burst_${Date.now()}`,
      userId: "system",
      kind: "desktop_observability",
      severity: "warning",
      title: "Muchos errores HTTP recientes",
      body: `Error rate ~${((totalsErrors / totalsN) * 100).toFixed(1)} % en la ventana ${window}`,
      status: "degraded",
      reasonCode: "elevated_error_rate",
      payloadJson: JSON.stringify({ errors: totalsErrors, requests: totalsN, window }),
      createdAt: iso,
      updatedAt: iso,
      syncVersion: 1,
    });
  }

  const oldestTs = counters.oldestRequestAtMs;
  const newestTs = counters.newestRequestAtMs;
  const buckets = buildBuckets(rows, countBuckets, windowMs, now);

  return {
    generatedAt: new Date().toISOString(),
    window,
    totals: {
      requests: totalsN,
      errors: totalsErrors,
      errorRate: totalsN ? totalsErrors / totalsN : 0,
      p50Ms: percentile(okAll, 0.5),
      p95Ms: percentile(okAll, 0.95),
      p99Ms: percentile(okAll, 0.99),
      rpsAvg: totalsN > 0 ? totalsN / (windowMs / 1000) : 0,
    },
    byScope: {
      saves: savesSummary,
      notifications: notificationsSummary,
      other: otherSummary,
      ws: {
        note: "Métricas WebSocket no están agregadas en este endpoint (API HTTP). Usa el panel local del desktop.",
        requests: 0,
        errors: 0,
      },
    },
    byMethod: buildByMethod(rows, counters.byMethod),
    statusBreakdown: buildStatusBreakdown(counters.byStatus),
    topSlowPaths: buildTopSlowPaths(rows, counters.byRoute),
    topErrorPaths: buildTopErrorPaths(counters.byRoute),
    topReasonCodes,
    buckets,
    coverage: {
      samplesInWindow: rows.length,
      requestsInWindow: totalsN,
      latencySamplesInWindow: rows.length,
      oldestSampleAtMs: oldestTs,
      newestSampleAtMs: newestTs,
      retentionLimit: MAX_SAMPLES,
      retainedSamples: ringCount,
      counterBucketMs: COUNTER_BUCKET_MS,
    },
    items,
    unreadCount: items.length,
  };
}
