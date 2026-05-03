import { Button, Card, CardBody, Select, SelectItem, Tooltip } from "@heroui/react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath } from "@tauri-apps/plugin-opener";
import { motion } from "framer-motion";
import { Activity, Copy, FileText, RefreshCw, RotateCw, Stethoscope } from "lucide-react";
import { useMemo, useState } from "react";
import { openOrFocusSettingsWindow } from "@/windows/settingsWindow";
import { focusMainWindow } from "@/windows/mainWindow";
import { useObservabilityHealth } from "@hooks/useObservabilityHealth";
import { sanitizeDiagnosticPayload } from "@services/tauri/observability.service";
import { toastError, toastSuccess } from "@utils/toast";
import {
  deriveKpis,
  formatNumber,
  formatPercent,
  formatRelative,
  formatRps,
  REMOTE_WINDOWS,
  SEVERITY_VISUAL,
  timeOfDay,
} from "@features/settings/observability/healthObservability.utils";
import type { HealthErrorEntry, RemoteMetricsBucket, SuggestedAction } from "@app-types/observability";

function PulseDot({ className }: { className: string }) {
  return (
    <span className="relative inline-flex h-2.5 w-2.5 items-center justify-center" aria-hidden="true">
      <motion.span
        className={`absolute inset-0 rounded-full ${className.split(" ")[0]} opacity-50`}
        animate={{ scale: [1, 2.4, 1], opacity: [0.45, 0, 0.45] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <span className={`relative inline-block h-2.5 w-2.5 rounded-full ${className}`} />
    </span>
  );
}

interface MetricCellProps {
  label: string;
  value: string;
  hint?: string;
  intent?: "neutral" | "warn" | "danger";
}

function MetricCell({ label, value, hint, intent = "neutral" }: MetricCellProps) {
  const valueClass =
    intent === "danger"
      ? "text-rose-600 dark:text-rose-300"
      : intent === "warn"
        ? "text-amber-600 dark:text-amber-300"
        : "text-foreground";
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-default-400">{label}</span>
      <span className={`font-mono text-2xl tabular-nums leading-none ${valueClass}`}>{value}</span>
      {hint ? <span className="text-[11px] text-default-500">{hint}</span> : null}
    </div>
  );
}

interface LatencyBarProps {
  p50: number | null;
  p95: number | null;
  p99?: number | null;
  ceiling?: number;
}

function LatencyBar({ p50, p95, p99, ceiling = 2500 }: LatencyBarProps) {
  const safeP50 = p50 ?? 0;
  const safeP95 = p95 ?? 0;
  const safeP99 = p99 ?? safeP95;
  const p50Pct = Math.min(100, (safeP50 / ceiling) * 100);
  const p95Pct = Math.min(100, (safeP95 / ceiling) * 100);
  const p99Pct = Math.min(100, (safeP99 / ceiling) * 100);
  const exceeded = (p95 ?? 0) > ceiling;

  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-default-400">
        <span>Latencia API · /saves</span>
        <span className="font-mono text-default-500">objetivo P95 &lt; {ceiling}ms</span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-default-200/60">
        <motion.div
          className="absolute inset-y-0 left-0 bg-foreground/80"
          initial={{ width: 0 }}
          animate={{ width: `${p50Pct}%` }}
          transition={{ type: "spring", stiffness: 90, damping: 20 }}
        />
        <motion.div
          className={`absolute inset-y-0 left-0 ${exceeded ? "bg-rose-500/70" : "bg-emerald-500/60"}`}
          style={{ mixBlendMode: "multiply" }}
          initial={{ width: 0 }}
          animate={{ width: `${p95Pct}%` }}
          transition={{ type: "spring", stiffness: 90, damping: 22 }}
        />
        {p99 != null ? (
          <motion.div
            className="absolute inset-y-0 w-[2px] bg-rose-500/80"
            initial={{ left: 0, opacity: 0 }}
            animate={{ left: `calc(${p99Pct}% - 1px)`, opacity: 1 }}
            transition={{ type: "spring", stiffness: 90, damping: 22 }}
            aria-hidden
          />
        ) : null}
      </div>
      <div className="flex justify-between font-mono text-[11px] text-default-500">
        <span>
          P50 <span className="text-foreground">{formatNumber(p50, " ms")}</span>
        </span>
        <span>
          P95 <span className={exceeded ? "text-rose-500" : "text-foreground"}>{formatNumber(p95, " ms")}</span>
        </span>
        <span>
          P99 <span className="text-foreground">{formatNumber(p99 ?? null, " ms")}</span>
        </span>
      </div>
    </div>
  );
}

interface SparklineProps {
  buckets: readonly RemoteMetricsBucket[];
}

function RequestsSparkline({ buckets }: SparklineProps) {
  const w = 320;
  const h = 60;
  const padding = 2;
  const data = buckets.map((b) => b.requests);
  const errors = buckets.map((b) => b.errors);
  const max = Math.max(1, ...data);
  const stepX = (w - padding * 2) / Math.max(1, buckets.length - 1);

  const points = data
    .map((v, i) => {
      const x = padding + i * stepX;
      const y = h - padding - (v / max) * (h - padding * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const areaPath = data.length
    ? `M ${padding},${h - padding} L ${points.split(" ").join(" L ")} L ${(w - padding).toFixed(2)},${h - padding} Z`
    : "";

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="block h-14 w-full text-default-500"
      role="img"
      aria-label="Volumen de peticiones por minuto">
      <defs>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {areaPath ? <path d={areaPath} fill="url(#sparkFill)" /> : null}
      {points ? (
        <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      ) : null}
      {errors.map((e, i) => {
        if (e <= 0) return null;
        const v = data[i] ?? 0;
        const cx = padding + i * stepX;
        const cy = h - padding - (v / max) * (h - padding * 2);
        return <circle key={i} cx={cx} cy={cy} r={1.6} className="fill-rose-500" />;
      })}
    </svg>
  );
}

interface ErrorRowProps {
  entry: HealthErrorEntry;
}

function ErrorRow({ entry }: ErrorRowProps) {
  const status = entry.statusCode ?? null;
  const isAuth = status === 401 || status === 403 || /unauthorized/i.test(entry.message);
  const tone = isAuth ? "text-rose-600 dark:text-rose-300" : "text-default-700 dark:text-default-200";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 110, damping: 22 }}
      className="grid grid-cols-[64px_44px_1fr] items-baseline gap-3 px-4 py-2 font-mono text-[12px] hover:bg-default-100/50">
      <span className="text-default-400 tabular-nums">{timeOfDay(entry.tsMs)}</span>
      <span className={`tabular-nums ${status != null && status >= 400 ? "text-rose-500" : "text-default-400"}`}>
        {status ?? "—"}
      </span>
      <span className="wrap-break-word text-[12px] leading-snug">
        <span className="mr-2 text-default-500">{entry.source}</span>
        <span className={tone}>{entry.message}</span>
      </span>
    </motion.div>
  );
}

function SuggestionChip({
  action,
  busy,
  onApply,
}: {
  action: SuggestedAction;
  busy?: boolean;
  onApply: (a: SuggestedAction) => void;
}) {
  const isPassive = !action.actionKind || action.actionKind === "copy_diagnostic";
  return (
    <Tooltip content={action.description} placement="top" delay={400}>
      <button
        type="button"
        disabled={busy}
        onClick={() => onApply(action)}
        className={`group inline-flex items-center gap-2 rounded-full border border-default-200 bg-default-50 px-3 py-1.5 text-[12px] font-medium text-default-700 transition active:translate-y-px hover:border-default-300 hover:bg-default-100 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-default-100/60 ${
          isPassive ? "" : "ring-1 ring-emerald-500/0 hover:ring-emerald-500/30"
        }`}>
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 transition group-hover:bg-emerald-500" />
        <span>{action.title}</span>
      </button>
    </Tooltip>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded-md bg-default-200/70" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-medium bg-default-200/60 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-20 bg-content1/60" />
        ))}
      </div>
      <div className="h-10 animate-pulse rounded-md bg-default-200/60" />
      <div className="h-32 animate-pulse rounded-md bg-default-200/60" />
    </div>
  );
}

export function HealthObservabilityCard() {
  const [remoteWindow, setRemoteWindow] = useState<string>("15m");
  const [restartBusy, setRestartBusy] = useState(false);
  const { data, isLoading, isError, error, refetch, isFetching } = useObservabilityHealth(remoteWindow);

  const visual = data ? SEVERITY_VISUAL[data.overallSeverity] : SEVERITY_VISUAL.ok;
  const kpis = useMemo(() => (data ? deriveKpis(data) : null), [data]);

  const handleSuggestedAction = async (action: SuggestedAction) => {
    const kind = action.actionKind ?? "";
    try {
      switch (kind) {
        case "restart_ws":
          setRestartBusy(true);
          await invoke("stop_cloud_ws");
          await invoke("start_cloud_ws");
          toastSuccess("WebSocket", "Conexión reiniciada.");
          await refetch();
          break;
        case "open_history":
          await emit("open-main-route", { route: "/history" });
          await focusMainWindow();
          await getCurrentWindow().hide();
          break;
        case "open_settings":
          await openOrFocusSettingsWindow();
          break;
        case "copy_diagnostic":
          if (!data) return;
          const payload = sanitizeDiagnosticPayload({
            mergedAt: data.mergedAtIso,
            overallSeverity: data.overallSeverity,
            local: data.local,
            remote: data.remote,
          });
          await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
          toastSuccess("Portapapeles", "Diagnóstico copiado.");
          break;
        default:
          break;
      }
    } catch (e) {
      toastError(action.title, e instanceof Error ? e.message : String(e));
    } finally {
      setRestartBusy(false);
    }
  };

  const handleRestart = () =>
    handleSuggestedAction({
      id: "restart_ws",
      title: "Reiniciar WebSocket",
      description: "",
      actionKind: "restart_ws",
    });
  const handleCopy = () =>
    handleSuggestedAction({
      id: "copy_diag",
      title: "Copiar diagnóstico",
      description: "",
      actionKind: "copy_diagnostic",
    });

  const openDebugLog = async () => {
    const path = data?.local.debugLogPath?.trim();
    if (!path) {
      toastError("Log", "No hay ruta de log disponible.");
      return;
    }
    try {
      await openPath(path);
    } catch (e) {
      toastError("Log", e instanceof Error ? e.message : String(e));
    }
  };

  const remoteTotals = data?.remote?.totals;
  const buckets = data?.remote?.buckets ?? [];
  const slowPaths = data?.remote?.topSlowPaths ?? [];
  const errorPaths = data?.remote?.topErrorPaths ?? [];
  const statusGranular = data?.remote?.statusBreakdown?.granular ?? [];
  const byMethod = data?.remote?.byMethod ?? {};

  return (
    <Card>
      <CardBody className="gap-0 p-0">
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-medium bg-default-100 text-default-500">
              <Stethoscope size={17} strokeWidth={1.5} />
            </div>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-foreground">Telemetría de salud</h2>
              <p className="text-[11px] text-default-500">Estado del cliente y la API.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-full border border-default-200 bg-default-50 px-2 py-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-default-400">Ventana</span>
              <Select
                size="sm"
                aria-label="Ventana temporal de la telemetría remota"
                selectedKeys={[remoteWindow]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0];
                  if (typeof v === "string") setRemoteWindow(v);
                }}
                className="min-w-20"
                classNames={{
                  trigger: "h-7 min-h-7 bg-transparent shadow-none border-0 px-1",
                  value: "font-mono text-[12px]",
                }}>
                {REMOTE_WINDOWS.map((w) => (
                  <SelectItem key={w} textValue={w}>
                    {w}
                  </SelectItem>
                ))}
              </Select>
            </div>
            <Button
              size="sm"
              variant="flat"
              isIconOnly
              isLoading={isFetching && !isLoading}
              aria-label="Refrescar telemetría"
              onPress={() => void refetch()}>
              <RefreshCw size={15} strokeWidth={1.5} />
            </Button>
          </div>
        </header>

        <div className="border-t border-default-200" />

        {isLoading ? (
          <div className="px-5 py-5">
            <HealthSkeleton />
          </div>
        ) : isError || !data || !kpis ? (
          <div className="flex flex-col items-start gap-3 px-5 py-6 text-sm text-danger">
            <span className="font-medium">No se pudo cargar la telemetría</span>
            <span className="text-default-500">{error instanceof Error ? error.message : "Error desconocido"}</span>
            <Button size="sm" variant="flat" onPress={() => void refetch()} startContent={<RotateCw size={14} />}>
              Reintentar
            </Button>
          </div>
        ) : (
          <>
            <section className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="flex items-center gap-3">
                <PulseDot className={visual.dotClass} />
                <div className="flex flex-col">
                  <span
                    className={`inline-flex w-fit items-center gap-2 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.18em] ${visual.pillClass}`}>
                    {visual.label}
                  </span>
                  <span className="mt-1 text-[12px] text-default-500">{visual.detail}</span>
                </div>
              </div>
              <div className="flex flex-col items-end font-mono text-[11px] text-default-500">
                <span>
                  snapshot <span className="text-foreground">{formatRelative(data.local.generatedAtMs)}</span>
                </span>
                {data.local.cloud.apiBaseHostPreview ? (
                  <span className="opacity-70">host {data.local.cloud.apiBaseHostPreview}</span>
                ) : null}
              </div>
            </section>

            <div className="border-t border-default-200" />

            <section className="grid grid-cols-2 gap-px bg-default-200/60 sm:grid-cols-5">
              <div className="bg-content1">
                <MetricCell
                  label="WebSocket"
                  value={kpis.wsState === "online" ? "Online" : kpis.wsState === "offline" ? "Offline" : "—"}
                  hint={
                    kpis.wsState === "online"
                      ? `${data.local.ws.totalSuccessfulConnections} conex. ok`
                      : kpis.wsState === "offline"
                        ? `desde ${formatRelative(data.local.ws.lastDisconnectedAtMs)}`
                        : "sin configurar"
                  }
                  intent={kpis.wsState === "offline" ? "warn" : "neutral"}
                />
              </div>
              <div className="bg-content1">
                <MetricCell
                  label="API P50"
                  value={formatNumber(data.local.syncApi.p50Ms, "ms")}
                  hint={`${data.local.syncApi.sampleCount} muestras`}
                />
              </div>
              <div className="bg-content1">
                <MetricCell
                  label="API P95"
                  value={formatNumber(data.local.syncApi.p95Ms, "ms")}
                  hint="ventana 15m"
                  intent={kpis.p95Intent}
                />
              </div>
              <div className="bg-content1">
                <MetricCell
                  label="Error rate"
                  value={formatPercent(kpis.errorRate)}
                  hint={`${data.local.syncApi.errorCount} errores`}
                  intent={kpis.errorRateIntent}
                />
              </div>
              <div className="bg-content1">
                <MetricCell
                  label="En cola"
                  value={String(data.local.ws.pendingQueueLen)}
                  hint={`unread ${data.local.notifications.unreadCount}`}
                  intent={kpis.pendingIntent}
                />
              </div>
            </section>

            <div className="border-t border-default-200" />

            <section>
              <LatencyBar p50={data.local.syncApi.p50Ms} p95={data.local.syncApi.p95Ms} />
            </section>

            {buckets.length > 0 ? (
              <>
                <div className="border-t border-default-200" />
                <section className="px-5 py-3">
                  <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-default-400">
                    <span>Tráfico API · {data.remote?.window ?? remoteWindow}</span>
                    <span className="font-mono text-default-500">
                      {formatRps(remoteTotals?.rpsAvg)} · {remoteTotals?.requests ?? 0} req
                    </span>
                  </div>
                  <RequestsSparkline buckets={buckets} />
                </section>
              </>
            ) : null}

            <div className="border-t border-default-200" />

            <section className="grid gap-0 sm:grid-cols-2 sm:divide-x sm:divide-default-200">
              <div className="px-5 py-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-default-400">
                  <Activity size={13} strokeWidth={1.5} />
                  <span>Servidor · {data.remote?.window ?? remoteWindow}</span>
                </div>
                {remoteTotals ? (
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-[12px] tabular-nums text-default-700 dark:text-default-200">
                    <li className="flex justify-between">
                      <span className="text-default-500">requests</span>
                      <span>{remoteTotals.requests ?? 0}</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-default-500">errors</span>
                      <span>{remoteTotals.errors ?? 0}</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-default-500">P50</span>
                      <span>{formatNumber(remoteTotals.p50Ms, " ms")}</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-default-500">P95</span>
                      <span>{formatNumber(remoteTotals.p95Ms, " ms")}</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-default-500">P99</span>
                      <span>{formatNumber(remoteTotals.p99Ms ?? null, " ms")}</span>
                    </li>
                    <li className="flex justify-between">
                      <span className="text-default-500">RPS</span>
                      <span>{formatRps(remoteTotals.rpsAvg)}</span>
                    </li>
                  </ul>
                ) : (
                  <p className="text-[12px] text-default-500">
                    Sin datos remotos. Revisa que la API exponga{" "}
                    <code className="font-mono">/observability/desktop/summary</code>.
                  </p>
                )}

                {Object.keys(byMethod).length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(byMethod).map(([method, m]) => (
                      <span
                        key={method}
                        className="inline-flex items-center gap-1.5 rounded-md border border-default-200 bg-default-50 px-2 py-0.5 font-mono text-[11px] text-default-700 dark:bg-default-100/40">
                        <span className="font-semibold text-default-500">{method}</span>
                        <span>{m.requests}</span>
                        {m.errors > 0 ? <span className="text-rose-500">{m.errors} err</span> : null}
                        {m.p95Ms != null ? <span className="text-default-400">{Math.round(m.p95Ms)}ms</span> : null}
                      </span>
                    ))}
                  </div>
                ) : null}

                {statusGranular.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {statusGranular.map((s) => {
                      const code = s.statusCode;
                      const tone =
                        code >= 500
                          ? "border-rose-500/40 text-rose-600 dark:text-rose-300"
                          : code >= 400
                            ? "border-amber-500/40 text-amber-600 dark:text-amber-300"
                            : "border-default-200 text-default-600";
                      return (
                        <span
                          key={code}
                          className={`inline-flex items-center gap-1 rounded-full border bg-default-50 px-2 py-0.5 font-mono text-[11px] dark:bg-default-100/40 ${tone}`}>
                          {code}
                          <span className="text-default-400">{s.count}</span>
                        </span>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="px-5 py-3">
                <div className="mb-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-[0.14em] text-default-400">
                  <span>Errores recientes</span>
                  <span className="font-mono lowercase text-default-500">15m</span>
                </div>
                {data.local.recentErrors.length === 0 ? (
                  <p className="text-[12px] text-default-500">Sin errores registrados en la ventana.</p>
                ) : (
                  <div className="-mx-5 max-h-44 divide-y divide-default-100 overflow-y-auto">
                    {data.local.recentErrors.map((e, i) => (
                      <ErrorRow key={`${e.tsMs}-${i}`} entry={e} />
                    ))}
                  </div>
                )}
              </div>
            </section>

            {slowPaths.length > 0 || errorPaths.length > 0 ? (
              <>
                <div className="border-t border-default-200" />
                <section className="grid gap-0 sm:grid-cols-2 sm:divide-x sm:divide-default-200">
                  <div className="px-5 py-3">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-default-400">
                      Rutas más lentas
                    </div>
                    {slowPaths.length === 0 ? (
                      <p className="text-[12px] text-default-500">Sin rutas con latencia destacada.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {slowPaths.map((p) => (
                          <li
                            key={p.route}
                            className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 font-mono text-[12px]">
                            <span className="truncate text-default-700 dark:text-default-200" title={p.route}>
                              {p.route}
                            </span>
                            <span className="text-default-400">{p.requests} req</span>
                            <span
                              className={
                                p.p95Ms != null && p.p95Ms > 2000
                                  ? "tabular-nums text-rose-500"
                                  : p.p95Ms != null && p.p95Ms > 1000
                                    ? "tabular-nums text-amber-500"
                                    : "tabular-nums text-default-700 dark:text-default-200"
                              }>
                              {formatNumber(p.p95Ms, " ms")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="px-5 py-3">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-default-400">
                      Rutas con errores
                    </div>
                    {errorPaths.length === 0 ? (
                      <p className="text-[12px] text-default-500">Sin rutas con errores en la ventana.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {errorPaths.map((p) => (
                          <li
                            key={p.route}
                            className="grid grid-cols-[1fr_auto_auto] items-baseline gap-3 font-mono text-[12px]">
                            <span className="truncate text-default-700 dark:text-default-200" title={p.route}>
                              {p.route}
                            </span>
                            {p.topStatus != null ? (
                              <span className="rounded-full border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-600 dark:text-rose-300">
                                {p.topStatus}
                              </span>
                            ) : (
                              <span />
                            )}
                            <span className="tabular-nums text-rose-500">{p.errors}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              </>
            ) : null}

            <div className="border-t border-default-200" />

            <section className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="flat"
                  color="primary"
                  startContent={<RotateCw size={14} strokeWidth={1.7} />}
                  isLoading={restartBusy}
                  onPress={() => void handleRestart()}>
                  Reiniciar WebSocket
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  startContent={<FileText size={14} strokeWidth={1.7} />}
                  onPress={() => void openDebugLog()}>
                  Abrir log
                </Button>
                <Button
                  size="sm"
                  variant="light"
                  startContent={<Copy size={14} strokeWidth={1.7} />}
                  onPress={() => void handleCopy()}>
                  Copiar diagnóstico
                </Button>
              </div>
              {data.local.suggestedActions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {data.local.suggestedActions
                    .filter((a) => a.actionKind !== "copy_diagnostic")
                    .slice(0, 4)
                    .map((a) => (
                      <SuggestionChip
                        key={a.id}
                        action={a}
                        busy={restartBusy && a.actionKind === "restart_ws"}
                        onApply={(act) => void handleSuggestedAction(act)}
                      />
                    ))}
                </div>
              ) : null}
            </section>
          </>
        )}
      </CardBody>
    </Card>
  );
}
