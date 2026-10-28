import { useSourcesDownloadsStore } from "@store/SourcesDownloadsStore";
import { useSyncStore } from "@store/SyncStore";
import { useTorrentStore } from "@store/TorrentStore";
import { DownloadsPanel } from "./DownloadsPanel";

export function TransferOverlayRouter() {
  const syncOperation = useSyncStore((state) => state.syncOperation);
  const syncProgress = useSyncStore((state) => state.progress);
  const syncActiveCount = useSyncStore((state) => state.activeCount);
  const pausedUploadInfo = useSyncStore((state) => state.pausedUploadInfo);
  const sourcesActiveCount = useSourcesDownloadsStore((state) => state.activeCount);
  const sourcesSyncProgress = useSourcesDownloadsStore((state) => state.syncProgress);
  const torrentProgress = useTorrentStore((state) => state.progress);
  const torrentActiveCount = useTorrentStore((state) => state.activeCount);

  const hasActiveTransfer =
    syncActiveCount > 0 ||
    sourcesActiveCount > 0 ||
    torrentActiveCount > 0 ||
    !!syncOperation ||
    !!syncProgress ||
    !!pausedUploadInfo ||
    !!sourcesSyncProgress?.inProgress ||
    !!torrentProgress;

  return hasActiveTransfer ? <DownloadsPanel forceVisible /> : null;
}
