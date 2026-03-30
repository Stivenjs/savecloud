import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Progress } from "@heroui/react";
import { ChevronDown, ChevronUp, Clock, Download, Pause, X, Zap } from "lucide-react";
import { useSyncStore } from "@store/SyncStore";
import { useTorrentStore } from "@store/TorrentStore";
import { formatBytes } from "@utils/format";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatEta, formatSpeed } from "@utils/progress";

type DownloadRow = {
  id: string;
  label: string;
  subtitle: string;
  value: number;
  source: "sync" | "torrent";
  canPause?: boolean;
  canCancel?: boolean;
  loaded?: number;
  total?: number;
  speedBps?: number | null;
  etaSeconds?: number | null;
};

export function DownloadsPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const syncTasks = useSyncStore((s) => s.activeTasksById);
  const aggregate = useSyncStore((s) => s.aggregateProgress);
  const torrentTasks = useTorrentStore((s) => s.activeByHash);
  const metricsRef = useRef<Record<string, { startMs: number; lastLoaded: number; gameId: string; filename: string }>>(
    {}
  );
  const [syncMetrics, setSyncMetrics] = useState<
    Record<string, { speedBps: number | null; etaSeconds: number | null }>
  >({});

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

    // limpia filas eliminadas
    const activeIds = new Set(Object.keys(syncTasks));
    for (const id of Object.keys(metricsRef.current)) {
      if (!activeIds.has(id)) delete metricsRef.current[id];
    }

    setSyncMetrics(nextMetrics);
  }, [syncTasks]);

  const rows = useMemo<DownloadRow[]>(() => {
    const syncRows = Object.entries(syncTasks).map(([id, task]) => {
      const value = task.total > 0 ? Math.min(100, Math.round((task.loaded / task.total) * 100)) : 0;
      const gameName = task.gameId ? formatGameDisplayName(task.gameId) : "Descarga";
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

    const torrentRows = Object.values(torrentTasks).map((task) => ({
      id: `torrent-${task.infoHash}`,
      label: task.name || "Torrent",
      subtitle: task.state,
      value: Math.max(0, Math.min(100, Math.round(task.progressPercent))),
      source: "torrent" as const,
      loaded: task.downloadedBytes,
      total: task.totalBytes,
      speedBps: task.downloadSpeedBytes,
      etaSeconds: task.etaSeconds,
    }));

    return [...syncRows, ...torrentRows];
  }, [syncTasks, syncMetrics, torrentTasks]);

  const totalActive = rows.length;
  if (totalActive === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 w-[360px] max-w-[90vw]">
      <div className="pointer-events-auto rounded-xl border border-default-200 bg-content1/95 p-3 shadow-lg backdrop-blur-sm">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Download size={16} className="text-primary" />
            <p className="text-sm font-semibold">Descargas activas ({totalActive})</p>
          </div>
          <Button
            isIconOnly
            size="sm"
            variant="light"
            aria-label={collapsed ? "Expandir descargas" : "Colapsar descargas"}
            onPress={() => setCollapsed((v) => !v)}>
            {collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
        </div>

        <Progress
          size="sm"
          value={aggregate.percent}
          aria-label="Progreso agregado de descargas"
          className="mb-2"
          showValueLabel
        />

        {!collapsed && (
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {rows.map((row) => (
              <div key={row.id} className="rounded-lg border border-default-100 bg-default-50/50 px-2 py-2">
                <p className="truncate text-xs font-medium">{row.label}</p>
                <p className="truncate text-[11px] text-default-500">{row.subtitle}</p>
                {row.source === "sync" && (row.canPause || row.canCancel) ? (
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-default-500">
                    {row.canPause ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-default-200 px-1.5 py-0.5">
                        <Pause size={10} />
                        Pausa
                      </span>
                    ) : null}
                    {row.canCancel ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-default-200 px-1.5 py-0.5">
                        <X size={10} />
                        Cancelar
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-default-500">
                  <span className="tabular-nums">
                    {formatBytes(row.loaded ?? 0)}
                    {(row.total ?? 0) > 0 ? ` / ${formatBytes(row.total ?? 0)}` : ""}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Zap size={10} />
                    {formatSpeed(row.speedBps ?? null)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock size={10} />
                    {formatEta(row.etaSeconds ?? null)}
                  </span>
                </div>
                <Progress size="sm" value={row.value} className="mt-1" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
