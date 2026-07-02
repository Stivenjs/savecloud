import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Progress, ScrollShadow } from "@heroui/react";
import { ChevronDown, ChevronUp, Clock, Download, Pause, Play, Upload, Users, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  cancelSourceDownload,
  cancelTorrent,
  pauseSourceDownload,
  pauseTorrent,
  resumeSourceDownload,
  resumeTorrent,
} from "@services/tauri";
import { useSourcesDownloadsStore } from "@store/SourcesDownloadsStore";
import { useSyncStore } from "@store/SyncStore";
import { useTorrentStore } from "@store/TorrentStore";
import { formatBytes, mapTorrentState } from "@utils/format";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatEta, formatSpeed } from "@utils/progress";

type DownloadRow = {
  id: string;
  label: string;
  subtitle: string;
  value: number;
  source: "sync" | "torrent" | "sources";
  jobId?: string;
  infoHash?: string;
  isPaused?: boolean;
  canPause?: boolean;
  canResume?: boolean;
  canCancel?: boolean;
  loaded?: number;
  total?: number;
  speedBps?: number | null;
  etaSeconds?: number | null;
  status?: string;
  /** Solo para filas de tipo torrent */
  torrentExtra?: {
    uploadSpeedBytes: number;
    peersConnected: number;
    state: string;
  };
};

function formatProtocol(protocol: string, t: (key: string) => string): string {
  switch (protocol) {
    case "http":
      return t("downloads.protocol.http");
    case "torrentMagnet":
    case "torrentFile":
    case "torrent":
      return t("downloads.protocol.torrent");
    case "peerLan":
      return t("downloads.protocol.peerLan");
    default:
      return t("downloads.protocol.default");
  }
}

function formatStatus(status: string, t: (key: string) => string): string {
  switch (status) {
    case "queued":
      return t("downloads.status.queued");
    case "running":
      return t("downloads.status.running");
    case "extracting":
      return t("downloads.status.extracting");
    case "pausing":
    case "paused":
      return t("downloads.status.paused");
    case "cancelling":
    case "cancelled":
      return t("downloads.status.cancelled");
    case "completed":
      return t("downloads.status.completed");
    case "failed":
      return t("downloads.status.failed");
    default:
      return status;
  }
}

export function DownloadsPanel() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const syncOperation = useSyncStore((s) => s.syncOperation);
  const syncTasks = useSyncStore((s) => s.activeTasksById);
  const aggregate = useSyncStore((s) => s.aggregateProgress);
  const sourcesTasks = useSourcesDownloadsStore((s) => s.activeByJobId);
  const sourcesAggregate = useSourcesDownloadsStore((s) => s.aggregateProgress);
  const torrentTasks = useTorrentStore((s) => s.activeByHash);
  const metricsRef = useRef<Record<string, { startMs: number; lastLoaded: number; gameId: string; filename: string }>>(
    {}
  );
  const [syncMetrics, setSyncMetrics] = useState<
    Record<string, { speedBps: number | null; etaSeconds: number | null }>
  >({});

  // Estado de toggle de pausa por torrent para deshabilitar el botón mientras la
  // llamada está en vuelo y evitar doble-click.
  const [togglingHash, setTogglingHash] = useState<string | null>(null);

  useEffect(() => {
    const now = performance.now();
    const nextMetrics: Record<string, { speedBps: number | null; etaSeconds: number | null }> = {};

    for (const [id, task] of Object.entries(syncTasks)) {
      const prev = metricsRef.current[id];
      const changedFile = !prev || prev.gameId !== task.gameId || prev.filename !== task.filename;
      const reset = changedFile || task.loaded < (prev?.lastLoaded ?? 0);

      if (reset) {
        metricsRef.current[id] = {
          startMs: now,
          lastLoaded: task.loaded,
          gameId: task.gameId,
          filename: task.filename,
        };
        nextMetrics[id] = { speedBps: null, etaSeconds: null };
        continue;
      }

      const dtMs = now - prev.startMs;
      if (dtMs <= 0 || task.loaded <= prev.lastLoaded) {
        nextMetrics[id] = { speedBps: null, etaSeconds: null };
        continue;
      }

      const speedBps = task.loaded / (dtMs / 1000);
      const elapsedSec = dtMs / 1000;
      const etaSeconds =
        task.total > 0 && speedBps > 0 && elapsedSec >= 2
          ? Math.min((task.total - task.loaded) / speedBps, 2 * 60 * 60)
          : null;

      metricsRef.current[id] = {
        ...prev,
        lastLoaded: task.loaded,
      };
      nextMetrics[id] = { speedBps, etaSeconds };
    }

    // Limpia filas eliminadas del mapa de métricas para liberar memoria.
    const activeIds = new Set(Object.keys(syncTasks));
    for (const id of Object.keys(metricsRef.current)) {
      if (!activeIds.has(id)) delete metricsRef.current[id];
    }

    setSyncMetrics(nextMetrics);
  }, [syncTasks]);

  const onToggleTorrentPause = useCallback(async (infoHash: string, isPaused: boolean) => {
    setTogglingHash(infoHash);
    try {
      if (isPaused) {
        await resumeTorrent(infoHash);
      } else {
        await pauseTorrent(infoHash);
      }
    } catch {
      // Silenciar: el estado se actualizará via evento en vivo.
    } finally {
      setTogglingHash(null);
    }
  }, []);

  const onCancelTorrent = useCallback((infoHash: string) => {
    cancelTorrent(infoHash)
      .then(() => useTorrentStore.getState().removeByHash(infoHash))
      .catch(() => {});
  }, []);

  const onCancelSource = useCallback((jobId: string, infoHash?: string) => {
    useSourcesDownloadsStore.getState().removeByJobId(jobId);
    if (infoHash) {
      useTorrentStore.getState().removeByHash(infoHash);
    }

    cancelSourceDownload(jobId)
      .then(() => {
        if (infoHash) {
          cancelTorrent(infoHash).catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const rows = useMemo<DownloadRow[]>(() => {
    const syncRows = Object.entries(syncTasks).map(([id, task]) => {
      const value = task.total > 0 ? Math.min(100, Math.round((task.loaded / task.total) * 100)) : 0;
      const gameName = task.gameId ? formatGameDisplayName(task.gameId) : t("downloads.defaultLabel");
      return {
        id,
        label: gameName,
        subtitle: task.filename,
        value,
        source: "sync" as const,
        canPause: !!task.canPause,
        canCancel: !!task.canCancel,
        loaded: task.loaded,
        total: task.total,
        speedBps: syncMetrics[id]?.speedBps ?? null,
        etaSeconds: syncMetrics[id]?.etaSeconds ?? null,
      };
    });

    /** Jobs de instalación por fuentes que ya tienen el mismo torrent en sesión: no duplicar fila en el panel. */
    const sourceTorrentHashes = new Set(
      Object.values(sourcesTasks)
        .filter(
          (j) =>
            (j.protocol === "torrentMagnet" || j.protocol === "torrentFile") &&
            typeof j.externalId === "string" &&
            j.externalId.length > 0
        )
        .map((j) => j.externalId as string)
    );

    const torrentRows = Object.values(torrentTasks)
      .filter((task) => !sourceTorrentHashes.has(task.infoHash))
      .map((task) => ({
        id: `torrent-${task.infoHash}`,
        infoHash: task.infoHash,
        label: task.name || t("downloads.torrentLabel"),
        subtitle: mapTorrentState(task.state),
        value: Math.max(0, Math.min(100, Math.round(task.progressPercent))),
        source: "torrent" as const,
        isPaused: task.state === "paused",
        canPause: task.state !== "completed",
        canCancel: task.state !== "completed",
        loaded: task.downloadedBytes,
        total: task.totalBytes,
        speedBps: task.downloadSpeedBytes,
        etaSeconds: task.etaSeconds,
        torrentExtra: {
          uploadSpeedBytes: task.uploadSpeedBytes,
          peersConnected: task.peersConnected,
          state: task.state,
        },
      }));

    const sourceRows = Object.values(sourcesTasks).map((task) => {
      const isTorrentBacked = task.protocol === "torrentMagnet" || task.protocol === "torrentFile";
      const torrent = isTorrentBacked && task.externalId ? torrentTasks[task.externalId] : undefined;

      let loaded = task.loaded;
      let total = task.total;

      if (torrent) {
        if (torrent.totalBytes > 0) {
          loaded = torrent.downloadedBytes;
          total = torrent.totalBytes;
        } else if (torrent.downloadedBytes > 0) {
          loaded = torrent.downloadedBytes;
        }
      }

      const value =
        total > 0
          ? Math.min(100, Math.round((loaded / total) * 100))
          : torrent
            ? Math.max(0, Math.min(100, Math.round(torrent.progressPercent)))
            : task.total > 0
              ? Math.min(100, Math.round((task.loaded / task.total) * 100))
              : 0;

      const subtitle = isTorrentBacked
        ? `${formatProtocol(task.protocol, t)} · ${torrent ? mapTorrentState(torrent.state) : t("downloads.preparingDownload")}`
        : `${formatProtocol(task.protocol, t)} · ${formatStatus(task.status, t)}`;

      return {
        id: `sources-${task.jobId}`,
        jobId: task.jobId,
        label: task.title || t("downloads.defaultLabel"),
        subtitle,
        value,
        source: "sources" as const,
        isPaused: task.status === "paused",
        canPause:
          (task.protocol === "peerLan" || task.protocol === "torrentMagnet" || task.protocol === "torrentFile") &&
          (task.status === "running" || task.status === "queued"),
        canResume:
          (task.protocol === "peerLan" || task.protocol === "torrentMagnet" || task.protocol === "torrentFile") &&
          task.status === "paused",
        canCancel: task.status === "queued" || task.status === "running" || task.status === "paused",
        loaded,
        total,
        speedBps: torrent ? torrent.downloadSpeedBytes : (task.downloadSpeedBytes ?? null),
        etaSeconds: torrent ? torrent.etaSeconds : (task.etaSeconds ?? null),
        infoHash: torrent?.infoHash,
        status: task.status,
        // Las filas de sources con torrent también exponen peers y upload
        // para que el panel muestre la misma riqueza de información.
        torrentExtra: torrent
          ? {
              uploadSpeedBytes: torrent.uploadSpeedBytes,
              peersConnected: torrent.peersConnected,
              state: torrent.state,
            }
          : undefined,
      };
    });

    return [...syncRows, ...sourceRows, ...torrentRows];
  }, [syncTasks, syncMetrics, sourcesTasks, torrentTasks, t]);

  const totalActive = rows.length;
  const keepPanelVisibleForBatch = syncOperation?.mode === "batch";
  if (totalActive === 0 && !keepPanelVisibleForBatch) return null;
  const visibleRows = rows.length > 0 ? rows.length : keepPanelVisibleForBatch ? 1 : 0;
  // Las filas de torrent tienen una línea extra de stats (upload + peers) y
  // los botones de acción, por lo que necesitan más espacio que las filas de sync.
  // Se usa 168 px como estimación conservadora para que el panel no corte ningún
  // elemento aunque haya una sola fila activa.
  const estimatedRowHeightPx = 168;
  const listMaxHeightPx = collapsed ? 0 : Math.min(visibleRows * estimatedRowHeightPx, 420);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-[380px] max-w-[90vw]">
      <div className="pointer-events-auto rounded-2xl border border-default-200/60 bg-content1/95 p-4 shadow-xl backdrop-blur-md transition-all duration-200 ease-out">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Download size={16} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">{t("downloads.title")}</p>
              <p className="text-xs text-default-400">{t("downloads.active", { count: totalActive })}</p>
            </div>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="flat"
            radius="lg"
            aria-label={collapsed ? t("downloads.expand") : t("downloads.collapse")}
            onPress={() => setCollapsed((v) => !v)}>
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
        </div>

        {/* Barra de progreso global */}
        <div className="mb-3 rounded-lg bg-default-100/50 p-2.5">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="text-default-500">{t("downloads.totalProgress")}</span>
            <span className="font-medium tabular-nums">
              {aggregate.total + sourcesAggregate.total > 0
                ? Math.min(
                    100,
                    Math.round(
                      ((aggregate.loaded + sourcesAggregate.loaded) / (aggregate.total + sourcesAggregate.total)) * 100
                    )
                  )
                : aggregate.percent}
              %
            </span>
          </div>
          <Progress
            size="sm"
            value={
              aggregate.total + sourcesAggregate.total > 0
                ? Math.min(
                    100,
                    Math.round(
                      ((aggregate.loaded + sourcesAggregate.loaded) / (aggregate.total + sourcesAggregate.total)) * 100
                    )
                  )
                : aggregate.percent
            }
            aria-label={t("downloads.aggregateProgressAria")}
            classNames={{
              track: "bg-default-200",
              indicator: "bg-gradient-to-r from-primary to-primary-400",
            }}
          />
        </div>

        <div
          className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
          style={{ maxHeight: `${listMaxHeightPx}px`, opacity: collapsed ? 0 : 1 }}>
          <ScrollShadow hideScrollBar className="max-h-[420px] space-y-2.5 pr-1" size={20} orientation="vertical">
            {rows.length === 0 && keepPanelVisibleForBatch ? (
              <div className="flex items-center gap-3 rounded-xl border border-default-200/40 bg-default-50/80 p-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Download size={18} className="animate-pulse text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t("downloads.preparingNext")}</p>
                  <p className="mt-0.5 text-xs text-default-400">{t("downloads.batchUploadActive")}</p>
                </div>
              </div>
            ) : null}

            {rows.map((row) => (
              <div
                key={row.id}
                className="group rounded-xl border border-default-200/40 bg-default-50/80 p-3 transition-colors hover:bg-default-100/60">
                {/* Título, subtítulo y porcentaje */}
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">{row.label}</p>
                    <p className="mt-0.5 truncate text-xs text-default-400">{row.subtitle}</p>
                  </div>
                  <span className="shrink-0 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-primary">
                    {row.value}%
                  </span>
                </div>

                {/* Barra de progreso */}
                <Progress
                  size="sm"
                  value={row.value}
                  classNames={{
                    track: "h-1.5 bg-default-200",
                    indicator: row.torrentExtra?.state === "paused" ? "bg-warning" : "bg-primary",
                  }}
                />

                {/* Stats comunes: bytes, velocidad de bajada y ETA */}
                <div className="mt-2 flex items-center gap-3 text-xs text-default-500">
                  <span className="tabular-nums">
                    {formatBytes(row.loaded ?? 0)}
                    {(row.total ?? 0) > 0 ? ` / ${formatBytes(row.total ?? 0)}` : ""}
                  </span>
                  {row.status === "extracting" ? null : (
                    <>
                      <span className="inline-flex items-center gap-1">
                        <Zap size={12} className="text-primary/70" />
                        <span className="tabular-nums">{formatSpeed(row.speedBps ?? null)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} className="text-default-400" />
                        <span className="tabular-nums">{formatEta(row.etaSeconds ?? null)}</span>
                      </span>
                    </>
                  )}
                </div>

                {/* Stats extra exclusivos de torrents: subida y peers */}
                {row.torrentExtra ? (
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-default-400">
                    <span className="inline-flex items-center gap-1">
                      <Upload size={11} className="shrink-0 text-default-400" aria-hidden />
                      <span className="tabular-nums">{formatSpeed(row.torrentExtra.uploadSpeedBytes)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users size={11} className="shrink-0 text-default-400" aria-hidden />
                      <span className="tabular-nums">
                        {t("downloads.peer", { count: row.torrentExtra.peersConnected })}
                      </span>
                    </span>
                  </div>
                ) : null}

                {/* Acciones para sync */}
                {row.source === "sync" && (row.canPause || row.canCancel) ? (
                  <div className="mt-2.5 flex items-center gap-2">
                    {row.canPause ? (
                      <button className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-default-100 px-2.5 py-1.5 text-xs font-medium text-default-600 transition-colors hover:bg-default-200">
                        <Pause size={12} />
                        {t("downloads.pause")}
                      </button>
                    ) : null}
                    {row.canCancel ? (
                      <button className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-danger-50 px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-100">
                        <X size={12} />
                        {t("downloads.cancel")}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* Acciones para sources */}
                {row.source === "sources" && row.jobId ? (
                  <div className="mt-2.5 flex items-center gap-2">
                    {row.canPause ? (
                      <button
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-default-100 px-2.5 py-1.5 text-xs font-medium text-default-600 transition-colors hover:bg-default-200"
                        onClick={() => void pauseSourceDownload(row.jobId!)}>
                        <Pause size={12} />
                        {t("downloads.pause")}
                      </button>
                    ) : null}
                    {row.canResume ? (
                      <button
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-success-50 px-2.5 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success-100"
                        onClick={() => void resumeSourceDownload(row.jobId!)}>
                        <Zap size={12} />
                        {t("downloads.resume")}
                      </button>
                    ) : null}
                    {row.canCancel ? (
                      <button
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-danger-50 px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-100"
                        onClick={() => onCancelSource(row.jobId!, row.infoHash)}>
                        <X size={12} />
                        {t("downloads.cancel")}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* Acciones para torrents directos (sin job de sources) */}
                {row.source === "torrent" && row.infoHash && (row.canPause || row.canCancel) ? (
                  <div className="mt-2.5 flex items-center gap-2">
                    {row.canPause ? (
                      <button
                        disabled={togglingHash === row.infoHash}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-default-100 px-2.5 py-1.5 text-xs font-medium text-default-600 transition-colors hover:bg-default-200 disabled:opacity-50"
                        onClick={() => void onToggleTorrentPause(row.infoHash!, !!row.isPaused)}>
                        {row.isPaused ? <Play size={12} /> : <Pause size={12} />}
                        {row.isPaused ? t("downloads.resume") : t("downloads.pause")}
                      </button>
                    ) : null}
                    {row.canCancel ? (
                      <button
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-danger-50 px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-100"
                        onClick={() => onCancelTorrent(row.infoHash!)}>
                        <X size={12} />
                        {t("downloads.cancel")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </ScrollShadow>
        </div>
      </div>
    </div>
  );
}
