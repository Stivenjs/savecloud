import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { formatSourcesSyncSubtitle, mapTorrentState } from "@utils/format";
import { formatGameDisplayName } from "@utils/gameImage";
import type { DownloadRow, DownloadsAggregateData } from "./types";

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

function formatCrawlerStage(stageOrKey: string, t: (key: string) => string): string {
  if (stageOrKey.startsWith("crawler:")) {
    const key = stageOrKey.replace("crawler:", "");
    const translated = t(`downloads.crawler.${key}`);
    if (translated && !translated.startsWith("downloads.crawler.")) {
      return translated;
    }
  }
  return stageOrKey;
}

export function useDownloadsData() {
  const { t } = useTranslation();
  const syncOperation = useSyncStore((s) => s.syncOperation);
  const syncTasks = useSyncStore((s) => s.activeTasksById);
  const aggregate = useSyncStore((s) => s.aggregateProgress);
  const sourcesTasks = useSourcesDownloadsStore((s) => s.activeByJobId);
  const sourcesAggregate = useSourcesDownloadsStore((s) => s.aggregateProgress);
  const sourcesSyncProgress = useSourcesDownloadsStore((s) => s.syncProgress);
  const torrentTasks = useTorrentStore((s) => s.activeByHash);

  const metricsRef = useRef<Record<string, { startMs: number; lastLoaded: number; gameId: string; filename: string }>>(
    {}
  );
  const [syncMetrics, setSyncMetrics] = useState<
    Record<string, { speedBps: number | null; etaSeconds: number | null }>
  >({});
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
      // Ignorar: el estado se actualiza por evento
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

  const onPauseSource = useCallback((jobId: string) => {
    void pauseSourceDownload(jobId);
  }, []);

  const onResumeSource = useCallback((jobId: string) => {
    void resumeSourceDownload(jobId);
  }, []);

  const rows = useMemo<DownloadRow[]>(() => {
    const syncRows: DownloadRow[] = Object.entries(syncTasks).map(([id, task]) => {
      const value = task.total > 0 ? Math.min(100, Math.round((task.loaded / task.total) * 100)) : 0;
      const gameName = task.gameId ? formatGameDisplayName(task.gameId) : t("downloads.defaultLabel");
      return {
        id,
        label: gameName,
        subtitle: task.filename,
        value,
        source: "sync",
        canPause: !!task.canPause,
        canCancel: !!task.canCancel,
        loaded: task.loaded,
        total: task.total,
        speedBps: syncMetrics[id]?.speedBps ?? null,
        etaSeconds: syncMetrics[id]?.etaSeconds ?? null,
      };
    });

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

    const torrentRows: DownloadRow[] = Object.values(torrentTasks)
      .filter((task) => !sourceTorrentHashes.has(task.infoHash))
      .map((task) => ({
        id: `torrent-${task.infoHash}`,
        infoHash: task.infoHash,
        label: task.name || t("downloads.torrentLabel"),
        subtitle: mapTorrentState(task.state),
        value: Math.max(0, Math.min(100, Math.round(task.progressPercent))),
        source: "torrent",
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

    const sourceRows: DownloadRow[] = Object.values(sourcesTasks).map((task) => {
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

      const statusText = task.statusDetail ? formatCrawlerStage(task.statusDetail, t) : formatStatus(task.status, t);
      const subtitle = isTorrentBacked
        ? `${formatProtocol(task.protocol, t)} · ${torrent ? mapTorrentState(torrent.state) : t("downloads.preparingDownload")}`
        : `${formatProtocol(task.protocol, t)} · ${statusText}`;

      return {
        id: `sources-${task.jobId}`,
        jobId: task.jobId,
        label: task.title || t("downloads.defaultLabel"),
        subtitle,
        value,
        source: "sources",
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
        statusDetail: task.statusDetail,
        torrentExtra: torrent
          ? {
              uploadSpeedBytes: torrent.uploadSpeedBytes,
              peersConnected: torrent.peersConnected,
              state: torrent.state,
            }
          : undefined,
      };
    });

    const syncSourcesRow: DownloadRow[] = sourcesSyncProgress?.inProgress
      ? [
          {
            id: "remote-sources-sync",
            label: t("sources.sync.title", { defaultValue: "Sincronizando fuentes" }),
            subtitle: formatSourcesSyncSubtitle(sourcesSyncProgress, t),
            value:
              sourcesSyncProgress.totalSources > 0
                ? Math.min(100, Math.round((sourcesSyncProgress.currentIndex / sourcesSyncProgress.totalSources) * 100))
                : 0,
            source: "sync",
            statusDetail: sourcesSyncProgress.stage,
            canPause: false,
            canCancel: false,
          },
        ]
      : [];

    return [...syncSourcesRow, ...syncRows, ...sourceRows, ...torrentRows];
  }, [syncTasks, syncMetrics, sourcesTasks, torrentTasks, sourcesSyncProgress, t]);

  const aggregateData: DownloadsAggregateData = useMemo(() => {
    const totalLoaded = aggregate.loaded + sourcesAggregate.loaded;
    const totalBytes = aggregate.total + sourcesAggregate.total;
    const percent = totalBytes > 0 ? Math.min(100, Math.round((totalLoaded / totalBytes) * 100)) : aggregate.percent;

    return {
      loaded: totalLoaded,
      total: totalBytes,
      percent,
    };
  }, [aggregate, sourcesAggregate]);

  return {
    rows,
    totalActive: rows.length,
    aggregate: aggregateData,
    keepPanelVisibleForBatch: syncOperation?.mode === "batch",
    sourcesSyncProgress,
    togglingHash,
    onToggleTorrentPause,
    onCancelTorrent,
    onCancelSource,
    onPauseSource,
    onResumeSource,
  };
}
