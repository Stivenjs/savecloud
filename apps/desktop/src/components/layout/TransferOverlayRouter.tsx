import { useEffect, useMemo, useState } from "react";
import { useSourcesDownloadsStore } from "@store/SourcesDownloadsStore";
import { useSyncStore } from "@store/SyncStore";
import { useTorrentStore } from "@store/TorrentStore";
import { DownloadsPanel } from "./DownloadsPanel";
import { SyncProgressBar } from "./SyncProgressBar";

type OverlayMode = "none" | "downloads_panel" | "sync_floating" | "torrent_bar";

const MODE_SWITCH_HYSTERESIS_MS = 250;

export function TransferOverlayRouter() {
  const syncOperation = useSyncStore((s) => s.syncOperation);
  const progress = useSyncStore((s) => s.progress);
  const pausedUploadInfo = useSyncStore((s) => s.pausedUploadInfo);
  const syncActiveCount = useSyncStore((s) => s.activeCount);
  const sourcesActiveCount = useSourcesDownloadsStore((s) => s.activeCount);
  const sourcesProgress = useSourcesDownloadsStore((s) => s.lastProgress);
  const torrentProgress = useTorrentStore((s) => s.progress);
  const torrentActiveCount = useTorrentStore((s) => s.activeCount);

  const totalActive = syncActiveCount + torrentActiveCount + sourcesActiveCount;
  const [downloadsPanelSessionActive, setDownloadsPanelSessionActive] = useState(false);
  const [mode, setMode] = useState<OverlayMode>("none");

  useEffect(() => {
    const hasAnyTransferSignal =
      totalActive > 0 || !!progress || !!torrentProgress || !!sourcesProgress || !!pausedUploadInfo || !!syncOperation;

    if (!hasAnyTransferSignal) {
      setDownloadsPanelSessionActive(false);
      return;
    }

    if (totalActive > 1 || syncOperation?.mode === "batch") {
      setDownloadsPanelSessionActive(true);
    }
  }, [totalActive, syncOperation, syncOperation?.mode, progress, torrentProgress, sourcesProgress, pausedUploadInfo]);

  const desiredMode = useMemo<OverlayMode>(() => {
    if (pausedUploadInfo) return "sync_floating";
    if (sourcesActiveCount > 0) return "downloads_panel";
    if (downloadsPanelSessionActive && (totalActive > 0 || syncOperation?.mode === "batch")) {
      return "downloads_panel";
    }

    const isPackagedOperation =
      progress?.filename?.includes("Empaquetando") ||
      progress?.filename?.includes("Extrayendo") ||
      progress?.filename?.startsWith("backups/") ||
      progress?.filename?.endsWith(".tar");

    if (progress && (syncOperation?.mode === "batch" || isPackagedOperation)) return "sync_floating";
    if (torrentProgress) return "torrent_bar";
    return "none";
  }, [
    downloadsPanelSessionActive,
    pausedUploadInfo,
    progress,
    sourcesActiveCount,
    syncOperation?.mode,
    torrentProgress,
    totalActive,
  ]);

  useEffect(() => {
    if (mode === desiredMode) return;
    const timeoutId = setTimeout(() => {
      setMode(desiredMode);
    }, MODE_SWITCH_HYSTERESIS_MS);
    return () => clearTimeout(timeoutId);
  }, [desiredMode, mode]);

  if (mode === "downloads_panel") {
    return <DownloadsPanel />;
  }
  if (mode === "sync_floating" || mode === "torrent_bar") {
    return <SyncProgressBar />;
  }
  return null;
}
