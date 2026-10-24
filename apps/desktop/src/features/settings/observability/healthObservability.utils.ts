import type { MergedObservability, ObservabilitySeverity } from "@app-types/observability";
import i18n from "@lib/i18n";

export const REMOTE_WINDOWS = ["5m", "15m", "1h", "24h"] as const;

export interface SeverityVisual {
  label: string;
  detail: string;
  dotClass: string;
  pillClass: string;
}

export function getSeverityVisual(severity: ObservabilitySeverity): SeverityVisual {
  switch (severity) {
    case "ok":
      return {
        label: i18n.t("settings.health.severity.ok.label", "OPERATIVO"),
        detail: i18n.t("settings.health.severity.ok.detail", "telemetría dentro de umbrales"),
        dotClass: "bg-emerald-400 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]",
        pillClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
      };
    case "warning":
      return {
        label: i18n.t("settings.health.severity.warning.label", "DEGRADADO"),
        detail: i18n.t("settings.health.severity.warning.detail", "indicadores fuera de objetivo"),
        dotClass: "bg-amber-400 shadow-[0_0_0_4px_rgba(245,158,11,0.18)]",
        pillClass: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
      };
    case "critical":
      return {
        label: i18n.t("settings.health.severity.critical.label", "CRÍTICO"),
        detail: i18n.t("settings.health.severity.critical.detail", "intervención sugerida"),
        dotClass: "bg-rose-500 shadow-[0_0_0_4px_rgba(244,63,94,0.20)]",
        pillClass: "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300",
      };
    case "unknown":
      return {
        label: i18n.t("settings.health.severity.unknown.label", "SIN DATOS"),
        detail: i18n.t("settings.health.severity.unknown.detail", "no hay métricas de servidor suficientes"),
        dotClass: "bg-default-400 shadow-[0_0_0_4px_rgba(148,163,184,0.16)]",
        pillClass: "border-default-300 bg-default-100 text-default-600 dark:text-default-300",
      };
  }
}

export function formatNumber(n: number | null | undefined, suffix = ""): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${Math.round(n)}${suffix}`;
}

export function formatPercent(rate: number | null | undefined, fractionDigits = 1): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(fractionDigits)}%`;
}

export function formatRps(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 10) return `${n.toFixed(1)} rps`;
  return `${n.toFixed(2)} rps`;
}

export function formatRelative(tsMs: number | null | undefined): string {
  if (tsMs == null) return "—";
  const diff = Date.now() - tsMs;
  if (diff < 0) return i18n.t("settings.health.relative.now", "ahora");
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return i18n.t("settings.health.relative.seconds", { count: sec, defaultValue: `hace ${sec}s` });
  const min = Math.floor(sec / 60);
  if (min < 60) return i18n.t("settings.health.relative.minutes", { count: min, defaultValue: `hace ${min}m` });
  const h = Math.floor(min / 60);
  if (h < 24) return i18n.t("settings.health.relative.hours", { count: h, defaultValue: `hace ${h}h` });
  const d = Math.floor(h / 24);
  return i18n.t("settings.health.relative.days", { count: d, defaultValue: `hace ${d}d` });
}

export function timeOfDay(tsMs: number): string {
  const d = new Date(tsMs);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export interface KpiSnapshot {
  wsState: "online" | "offline" | "unconfigured";
  errorRate: number | null;
  errorRateIntent: "neutral" | "warn" | "danger";
  p95Intent: "neutral" | "warn" | "danger";
  pendingIntent: "neutral" | "warn" | "danger";
}

export function deriveKpis(data: MergedObservability): KpiSnapshot {
  const serverTotals = data.remote?.totals;
  const serverRequests = serverTotals?.requests ?? 0;
  const serverErrors = serverTotals?.errors ?? 0;
  const rate = serverTotals?.errorRate ?? (serverRequests > 0 ? serverErrors / serverRequests : null);
  return {
    wsState: !data.local.cloud.configured ? "unconfigured" : data.local.ws.connected ? "online" : "offline",
    errorRate: rate,
    errorRateIntent:
      rate != null && serverRequests >= 5 ? (rate > 0.25 ? "danger" : rate > 0.1 ? "warn" : "neutral") : "neutral",
    p95Intent:
      serverTotals?.p95Ms != null && serverTotals.p95Ms > 2500
        ? "danger"
        : serverTotals?.p95Ms != null && serverTotals.p95Ms > 1500
          ? "warn"
          : "neutral",
    pendingIntent: data.local.ws.pendingQueueLen > 20 ? "warn" : "neutral",
  };
}
