import { invoke } from "@tauri-apps/api/core";
import type {
  DesktopHealthSnapshot,
  MergedObservability,
  ObservabilitySeverity,
  RemoteObservabilitySummary,
} from "@app-types/observability";

export const OBSERVABILITY_HEALTH_QUERY_KEY = ["observability", "health"] as const;

export async function getLocalObservabilitySnapshot(): Promise<DesktopHealthSnapshot> {
  return invoke<DesktopHealthSnapshot>("get_observability_snapshot");
}

export async function getRemoteObservabilitySummaryRaw(window: string): Promise<RemoteObservabilitySummary | null> {
  const v = await invoke<RemoteObservabilitySummary | null>("get_remote_observability_summary", { window });
  return v;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

/** Elimina campos sensibles antes de copiar / logs. */
export function sanitizeDiagnosticPayload(data: unknown): unknown {
  if (data === null || typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map(sanitizeDiagnosticPayload);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const lower = k.toLowerCase();
    if (
      lower.includes("apikey") ||
      lower.includes("api_key") ||
      lower === "authorization" ||
      lower.includes("token") ||
      lower.includes("secret")
    ) {
      out[k] = "[redacted]";
      continue;
    }
    out[k] = sanitizeDiagnosticPayload(v);
  }
  return out;
}

function overallSeverity(
  local: DesktopHealthSnapshot,
  remote: RemoteObservabilitySummary | null
): ObservabilitySeverity {
  const authish = local.recentErrors.some(
    (e) => e.statusCode === 401 || e.message.includes("401") || e.message.toLowerCase().includes("unauthorized")
  );
  if (authish) return "critical";

  if (local.cloud.configured && !local.ws.connected) {
    const offMs = local.ws.lastDisconnectedAtMs != null ? Date.now() - local.ws.lastDisconnectedAtMs : 0;
    if (offMs > 120_000) return "critical";
    if (offMs > 30_000) return "warning";
  }

  const rate = local.syncApi.sampleCount > 0 ? local.syncApi.errorCount / local.syncApi.sampleCount : 0;
  if (local.syncApi.sampleCount >= 8 && rate > 0.25) return "critical";
  if (local.syncApi.sampleCount >= 5 && rate > 0.15) return "warning";

  const rRate = remote?.totals?.requests ? (remote.totals.errors ?? 0) / (remote.totals.requests || 1) : 0;
  if ((remote?.totals?.requests ?? 0) >= 20 && rRate > 0.2) return "warning";

  return "ok";
}

export async function fetchMergedObservability(window: string): Promise<MergedObservability> {
  const [local, remoteRaw] = await Promise.all([
    getLocalObservabilitySnapshot(),
    getRemoteObservabilitySummaryRaw(window),
  ]);
  const remote = remoteRaw && isRecord(remoteRaw as object) ? (remoteRaw as RemoteObservabilitySummary) : null;
  return {
    local,
    remote,
    overallSeverity: overallSeverity(local, remote),
    mergedAtIso: new Date().toISOString(),
  };
}
