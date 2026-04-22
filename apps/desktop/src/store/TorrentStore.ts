import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { getActiveTorrentDownloads } from "@services/tauri/config.service";

export type TorrentDownloadState = "starting" | "checking" | "downloading" | "paused" | "completed";

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
  tombstones: Set<string>;
  setProgress: (progress: TorrentProgressState | null) => void;
  removeByHash: (infoHash: string) => void;
  hydrateActive: () => Promise<void>;
}

export const useTorrentStore = create<TorrentStore>((set) => ({
  progress: null,
  activeByHash: {},
  activeCount: 0,
  tombstones: new Set(),
  setProgress: (progress) => {
    set((state) => {
      const next = { ...state.activeByHash };

      if (progress?.infoHash) {
        if (state.tombstones.has(progress.infoHash)) {
          return state;
        }

        const isChecking =
          progress.state === "starting" &&
          progress.downloadSpeedBytes === 0 &&
          progress.downloadedBytes === 0 &&
          progress.totalBytes > 0;

        const normalizedState = isChecking ? "checking" : progress.state;

        const updated = {
          ...progress,
          state: normalizedState,
        };

        if (normalizedState !== "completed") {
          next[progress.infoHash] = updated;
        } else {
          delete next[progress.infoHash];
        }
      }

      return {
        activeByHash: next,
        activeCount: Object.keys(next).length,
        progress:
          progress?.state === "completed"
            ? state.progress?.infoHash === progress.infoHash
              ? null
              : state.progress
            : progress,
      };
    });
  },
  removeByHash: (infoHash) => {
    set((state) => {
      const next = { ...state.activeByHash };
      delete next[infoHash];

      const nextTombstones = new Set(state.tombstones);
      nextTombstones.add(infoHash);

      const nextProgress = state.progress?.infoHash === infoHash ? null : state.progress;
      return {
        activeByHash: next,
        activeCount: Object.keys(next).length,
        progress: nextProgress,
        tombstones: nextTombstones,
      };
    });

    setTimeout(() => {
      useTorrentStore.setState((state) => {
        const nextTombstones = new Set(state.tombstones);
        nextTombstones.delete(infoHash);
        return { tombstones: nextTombstones };
      });
    }, 5000);
  },
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
