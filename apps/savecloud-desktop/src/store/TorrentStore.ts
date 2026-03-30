import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { getActiveTorrentDownloads } from "@services/tauri/config.service";

export type TorrentDownloadState = "starting" | "downloading" | "paused" | "completed";

export interface TorrentProgressState {
  infoHash: string;
  name: string;
  progressPercent: number;
  downloadSpeedBytes: number;
  uploadSpeedBytes: number;
  state: TorrentDownloadState;
  totalBytes: number;
  downloadedBytes: number;
  etaSeconds: number | null;
  peersConnected: number;
}

interface TorrentStore {
  progress: TorrentProgressState | null;
  activeByHash: Record<string, TorrentProgressState>;
  activeCount: number;
  setProgress: (progress: TorrentProgressState | null) => void;
  removeByHash: (infoHash: string) => void;
  hydrateActive: () => Promise<void>;
}

export const useTorrentStore = create<TorrentStore>((set) => ({
  progress: null,
  activeByHash: {},
  activeCount: 0,
  setProgress: (progress) => {
    set((state) => {
      const next = { ...state.activeByHash };
      if (progress?.infoHash && progress.state !== "completed") {
        next[progress.infoHash] = progress;
      } else if (progress?.infoHash) {
        delete next[progress.infoHash];
      }
      const nextProgress =
        progress?.state === "completed"
          ? state.progress?.infoHash === progress.infoHash
            ? null
            : state.progress
          : progress;
      return { progress: nextProgress, activeByHash: next, activeCount: Object.keys(next).length };
    });
  },
  removeByHash: (infoHash) =>
    set((state) => {
      const next = { ...state.activeByHash };
      delete next[infoHash];
      const nextProgress = state.progress?.infoHash === infoHash ? null : state.progress;
      return { activeByHash: next, activeCount: Object.keys(next).length, progress: nextProgress };
    }),
  hydrateActive: async () => {
    try {
      const hashes = await getActiveTorrentDownloads();
      set((state) => {
        const next = { ...state.activeByHash };
        for (const hash of hashes) {
          if (!next[hash]) {
            next[hash] = {
              infoHash: hash,
              name: hash,
              progressPercent: 0,
              downloadSpeedBytes: 0,
              uploadSpeedBytes: 0,
              state: "starting",
              totalBytes: 0,
              downloadedBytes: 0,
              etaSeconds: null,
              peersConnected: 0,
            };
          }
        }
        return { activeByHash: next, activeCount: Object.keys(next).length };
      });
    } catch {
      // Best effort, luego llegan eventos en vivo.
    }
  },
}));

let listenersInitialized = false;

export function initTorrentListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  const { setProgress, removeByHash, hydrateActive } = useTorrentStore.getState();
  hydrateActive();

  listen<TorrentProgressState>("torrent-download-progress", (ev) => {
    setProgress(ev.payload);
  });

  listen<string>("torrent-download-cancelled", (ev) => {
    removeByHash(ev.payload);
  });

  listen<TorrentProgressState>("torrent-download-done", (ev) => {
    setProgress({ ...ev.payload, state: "completed", progressPercent: 100 });
  });
}
