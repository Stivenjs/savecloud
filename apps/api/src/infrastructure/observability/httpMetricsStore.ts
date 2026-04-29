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

/** Expuesto solo para pruebas. */
export function resetHttpMetricsForTests(): void {
  samples.length = 0;
}

export function recordHttpMetric(entry: Omit<HttpMetricsSample, "ts">): void {
  samples.push({ ...entry, ts: Date.now() });
  if (samples.length > MAX_SAMPLES) {
    samples.splice(0, samples.length - MAX_SAMPLES);
  }
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
  /** Muestras realmente consideradas en la ventana. */
  samplesInWindow: number;
  oldestSampleAtMs: number | null;
  newestSampleAtMs: number | null;
  /** Capacidad total del buffer (límite duro en memoria). */
  retentionLimit: number;
  /** Muestras retenidas globalmente, todas ventanas. */
  retainedSamples: number;
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

function reduceScope(rows: HttpMetricsSample[]): ScopeSummaryDto {
  const n = rows.length;
  if (n === 0) return emptyScope();
  const errors = rows.filter((r) => r.statusCode >= 400).length;
  const okDurations = rows.filter((r) => r.statusCode < 400).map((r) => r.durationMs);
  okDurations.sort((a, b) => a - b);
  return {
    requests: n,
    errors,
    p50Ms: percentile(okDurations, 0.5),
    p95Ms: percentile(okDurations, 0.95),
    p99Ms: percentile(okDurations, 0.99),
  };
}

function buildBuckets(rows: HttpMetricsSample[], windowMs: number, now: number): MetricsBucketDto[] {
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
    slot.requests += 1;
    if (r.statusCode >= 400) {
      slot.errors += 1;
    } else {
      const arr = okPerBucket[idx];
      if (arr) arr.push(r.durationMs);
    }
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

function buildTopSlowPaths(rows: HttpMetricsSample[]): PathLatencyEntryDto[] {
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
  for (const [route, arr] of grouped.entries()) {
    if (arr.length < 3) continue;
    arr.sort((a, b) => a - b);
    out.push({
      route,
      requests: arr.length,
      p95Ms: percentile(arr, 0.95),
      p99Ms: percentile(arr, 0.99),
    });
  }
  out.sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0));
  return out.slice(0, 5);
}

function buildTopErrorPaths(rows: HttpMetricsSample[]): PathErrorEntryDto[] {
  const grouped = new Map<string, { total: number; errors: number; statusFreq: Map<number, number> }>();
  for (const r of rows) {
    const key = effectiveRoute(r);
    let agg = grouped.get(key);
    if (!agg) {
      agg = { total: 0, errors: 0, statusFreq: new Map() };
      grouped.set(key, agg);
    }
    agg.total += 1;
    if (r.statusCode >= 400) {
      agg.errors += 1;
      agg.statusFreq.set(r.statusCode, (agg.statusFreq.get(r.statusCode) ?? 0) + 1);
    }
  }
  const out: PathErrorEntryDto[] = [];
  for (const [route, agg] of grouped.entries()) {
    if (agg.errors === 0) continue;
    let topStatus: number | null = null;
    let topCount = -1;
    for (const [code, c] of agg.statusFreq.entries()) {
      if (c > topCount) {
        topStatus = code;
        topCount = c;
      }
    }
    out.push({
      route,
      errors: agg.errors,
      errorRate: agg.total > 0 ? agg.errors / agg.total : 0,
      topStatus,
    });
  }
  out.sort((a, b) => b.errors - a.errors);
  return out.slice(0, 5);
}

function buildStatusBreakdown(rows: HttpMetricsSample[]): ObservabilitySummaryDto["statusBreakdown"] {
  const classes: Record<"1xx" | "2xx" | "3xx" | "4xx" | "5xx", number> = {
    "1xx": 0,
    "2xx": 0,
    "3xx": 0,
    "4xx": 0,
    "5xx": 0,
  };
  const granular = new Map<number, number>();
  for (const r of rows) {
    const code = r.statusCode;
    if (code >= 100 && code < 200) classes["1xx"] += 1;
    else if (code >= 200 && code < 300) classes["2xx"] += 1;
    else if (code >= 300 && code < 400) classes["3xx"] += 1;
    else if (code >= 400 && code < 500) classes["4xx"] += 1;
    else if (code >= 500 && code < 600) classes["5xx"] += 1;
    granular.set(code, (granular.get(code) ?? 0) + 1);
  }
  const granularArr = [...granular.entries()]
    .map(([statusCode, count]) => ({ statusCode, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return { classes, granular: granularArr };
}

function buildByMethod(rows: HttpMetricsSample[]): ObservabilitySummaryDto["byMethod"] {
  const grouped = new Map<string, { ok: number[]; total: number; errors: number }>();
  for (const r of rows) {
    const m = (r.method || "GET").toUpperCase();
    let agg = grouped.get(m);
    if (!agg) {
      agg = { ok: [], total: 0, errors: 0 };
      grouped.set(m, agg);
    }
    agg.total += 1;
    if (r.statusCode >= 400) {
      agg.errors += 1;
    } else {
      agg.ok.push(r.durationMs);
    }
  }
  const out: ObservabilitySummaryDto["byMethod"] = {};
  for (const [method, agg] of grouped.entries()) {
    agg.ok.sort((a, b) => a - b);
    out[method] = {
      requests: agg.total,
      errors: agg.errors,
      p95Ms: percentile(agg.ok, 0.95),
    };
  }
  return out;
}

export function summarizeHttpMetrics(windowParam: string): ObservabilitySummaryDto {
  const window = OBSERVABILITY_WINDOWS.includes(windowParam as ObservabilityWindow) ? windowParam : "15m";
  const windowMs = windowParamToMs(window);
  const now = Date.now();
  const cutoff = now - windowMs;
  const rows = samples.filter((s) => s.ts >= cutoff);

  const byPathScope = {
    saves: rows.filter((r) => classifyPath(r.path) === "saves"),
    notifications: rows.filter((r) => classifyPath(r.path) === "notifications"),
    other: rows.filter((r) => classifyPath(r.path) === "other"),
  };

  const savesSummary = reduceScope(byPathScope.saves);
  const notificationsSummary = reduceScope(byPathScope.notifications);
  const otherSummary = reduceScope(byPathScope.other);

  const totalsRows = rows;
  const totalsN = totalsRows.length;
  const totalsErrors = totalsRows.filter((r) => r.statusCode >= 400).length;
  const okAll = totalsRows.filter((r) => r.statusCode < 400).map((r) => r.durationMs);
  okAll.sort((a, b) => a - b);

  const reasonMap = new Map<string, number>();
  for (const r of totalsRows) {
    if (r.statusCode < 400) continue;
    const code = reasonCodeFromStatus(r.statusCode);
    reasonMap.set(code, (reasonMap.get(code) ?? 0) + 1);
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

  const oldestTs = rows.length > 0 ? Math.min(...rows.map((r) => r.ts)) : null;
  const newestTs = rows.length > 0 ? Math.max(...rows.map((r) => r.ts)) : null;
  const buckets = buildBuckets(rows, windowMs, now);

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
    byMethod: buildByMethod(rows),
    statusBreakdown: buildStatusBreakdown(rows),
    topSlowPaths: buildTopSlowPaths(rows),
    topErrorPaths: buildTopErrorPaths(rows),
    topReasonCodes,
    buckets,
    coverage: {
      samplesInWindow: rows.length,
      oldestSampleAtMs: oldestTs,
      newestSampleAtMs: newestTs,
      retentionLimit: MAX_SAMPLES,
      retainedSamples: samples.length,
    },
    items,
    unreadCount: items.length,
  };
}
