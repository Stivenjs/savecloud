import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  listSourceDownloadJobs,
  type SourceDownloadJob,
  type SourceProgressPayload,
} from "@services/tauri/sources.service";

type SourcesAggregate = {
  loaded: number;
  total: number;
  percent: number;
};

interface SourcesDownloadsStore {
  lastProgress: SourceDownloadJob | null;
  activeByJobId: Record<string, SourceDownloadJob>;
  activeCount: number;
  tombstones: Set<string>;
  aggregateProgress: SourcesAggregate;
  hydrateActive: () => Promise<void>;
  upsertFromPayload: (payload: SourceProgressPayload) => void;
  removeByJobId: (jobId: string) => void;
}

function isActive(job: SourceDownloadJob): boolean {
  return job.status === "queued" || job.status === "running" || job.status === "paused";
}

function buildAggregate(activeByJobId: Record<string, SourceDownloadJob>): SourcesAggregate {
  const rows = Object.values(activeByJobId).filter(isActive);
  const loaded = rows.reduce((acc, row) => acc + Math.max(0, row.loaded), 0);
  const total = rows.reduce((acc, row) => acc + Math.max(0, row.total), 0);
  const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return { loaded, total, percent };
}

export const useSourcesDownloadsStore = create<SourcesDownloadsStore>((set) => ({
  lastProgress: null,
  activeByJobId: {},
  activeCount: 0,
  tombstones: new Set(),
  aggregateProgress: { loaded: 0, total: 0, percent: 0 },
  hydrateActive: async () => {
    try {
      const jobs = await listSourceDownloadJobs();
      set(() => {
        const next: Record<string, SourceDownloadJob> = {};
        for (const job of jobs) {
          if (isActive(job)) {
            next[job.jobId] = job;
          }
        }
        return {
          activeByJobId: next,
          activeCount: Object.keys(next).length,
          aggregateProgress: buildAggregate(next),
        };
      });
    } catch {
      // Best effort: luego llegan eventos en vivo.
    }
  },
  upsertFromPayload: (payload) => {
    set((state) => {
      if (state.tombstones.has(payload.jobId)) {
        return state;
      }

      const current = state.activeByJobId[payload.jobId];
      const nextJob: SourceDownloadJob = {
        jobId: payload.jobId,
        sourceId: current?.sourceId ?? "",
        itemId: current?.itemId ?? "",
        title: payload.title,
        destinationDir: current?.destinationDir ?? "",
        selectedUri: current?.selectedUri ?? "",
        protocol: payload.protocol,
        status: payload.status,
        loaded: payload.loaded,
        total: payload.total,
        downloadSpeedBytes: payload.downloadSpeedBytes ?? 0,
        etaSeconds: payload.etaSeconds ?? null,
        error: payload.error ?? current?.error ?? null,
        externalId: payload.externalId ?? current?.externalId ?? null,
        createdAt: current?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const next = { ...state.activeByJobId };
      if (isActive(nextJob)) {
        next[payload.jobId] = nextJob;
      } else {
        delete next[payload.jobId];
      }
      return {
        lastProgress: nextJob,
        activeByJobId: next,
        activeCount: Object.keys(next).length,
        aggregateProgress: buildAggregate(next),
      };
    });
  },
  removeByJobId: (jobId) => {
    set((state) => {
      const next = { ...state.activeByJobId };
      delete next[jobId];

      const nextTombstones = new Set(state.tombstones);
      nextTombstones.add(jobId);

      return {
        activeByJobId: next,
        activeCount: Object.keys(next).length,
        aggregateProgress: buildAggregate(next),
        tombstones: nextTombstones,
      };
    });

    setTimeout(() => {
      useSourcesDownloadsStore.setState((state) => {
        const nextTombstones = new Set(state.tombstones);
        nextTombstones.delete(jobId);
        return { tombstones: nextTombstones };
      });
    }, 5000);
  },
}));

let listenersInitialized = false;

export function initSourcesListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  const store = useSourcesDownloadsStore.getState();
  store.hydrateActive();

  listen<SourceProgressPayload>("sources-download-progress", (ev) => {
    useSourcesDownloadsStore.getState().upsertFromPayload(ev.payload);
  });

  listen<SourceProgressPayload>("sources-download-terminal", (ev) => {
    useSourcesDownloadsStore.getState().upsertFromPayload(ev.payload);
  });
}
