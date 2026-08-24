import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  getActiveDownloadsState,
  getPausedUploadInfo,
  type StreamingDryRunMetrics,
} from "@services/tauri/config.service";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatBytes } from "@utils/format";
import {
  notifyDownloadDone,
  notifyFullBackupDone,
  notifyStreamingDryRunDone,
  notifyUploadDone,
} from "@utils/notification";
import { useStreamingMetricsStore } from "@store/StreamingMetricsStore";

export interface SyncProgressState {
  type: "upload" | "download";
  operationId?: string;
  status?: "queued" | "running" | "pausing" | "paused" | "cancelling" | "cancelled" | "completed" | "failed";
  canPause?: boolean;
  canCancel?: boolean;
  canResume?: boolean;
  strategy?: "simple" | "multipart" | "streaming" | "downloadFile" | "downloadPackaged";
  reasonCode?: string;
  gameId: string;
  filename: string;
  loaded: number;
  total: number;
}

export type SyncProgressMode = "single" | "batch";

export interface SyncOperation {
  type: "upload" | "download";
  mode: SyncProgressMode;
  gameId: string | null;
  operationId?: string;
}

export interface PausedUploadInfo {
  gameId: string;
  filename: string;
}

interface SyncStore {
  syncOperation: SyncOperation | null;
  progress: SyncProgressState | null;
  activeTasksById: Record<string, SyncProgressState>;
  activeCount: number;
  aggregateProgress: { loaded: number; total: number; percent: number };
  pausedUploadInfo: PausedUploadInfo | null;

  setSyncOperation: (op: SyncOperation | null) => void;
  setProgress: (
    progress: SyncProgressState | null | ((prev: SyncProgressState | null) => SyncProgressState | null)
  ) => void;
  refreshPausedUploadInfo: () => Promise<void>;
  clearPausedUploadInfo: () => void;
  upsertTask: (task: SyncProgressState) => void;
  removeTaskById: (taskId: string) => void;
  removeTaskByOperationId: (operationId?: string | null) => void;
  clearTasksByType: (type: SyncProgressState["type"]) => void;
  hydrateActiveTasks: () => Promise<void>;
}

/** Si llevamos 100% más de este tiempo sin recibir *-done, ocultamos por si el evento se perdió. */
const STALE_100_PERCENT_MS = 4000;
let staleTimer: ReturnType<typeof setTimeout> | null = null;

function isTaskFinished(task: SyncProgressState): boolean {
  const reachedTotal = task.total > 0 && task.loaded >= task.total;
  return reachedTotal || task.status === "completed" || task.status === "failed";
}

function buildTaskId(progress: SyncProgressState): string {
  if (progress.operationId?.trim()) return progress.operationId;
  return `${progress.type}-${progress.gameId}-${progress.filename}`;
}

function buildAggregates(activeTasksById: Record<string, SyncProgressState>) {
  const tasks = Object.values(activeTasksById).filter((task) => !isTaskFinished(task));
  const activeCount = tasks.length;
  const loaded = tasks.reduce((acc, t) => acc + Math.max(0, t.loaded), 0);
  const total = tasks.reduce((acc, t) => acc + Math.max(0, t.total), 0);
  const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
  return { activeCount, aggregateProgress: { loaded, total, percent } };
}

export const useSyncStore = create<SyncStore>((set) => ({
  syncOperation: null,
  progress: null,
  activeTasksById: {},
  activeCount: 0,
  aggregateProgress: { loaded: 0, total: 0, percent: 0 },
  pausedUploadInfo: null,

  setSyncOperation: (op) => {
    set({ syncOperation: op });
    if (!op) set({ progress: null });
  },

  setProgress: (newProgress) => {
    set((state) => {
      const nextProgress = typeof newProgress === "function" ? newProgress(state.progress) : newProgress;

      if (staleTimer) {
        clearTimeout(staleTimer);
        staleTimer = null;
      }

      if (nextProgress && nextProgress.total > 0 && nextProgress.loaded >= nextProgress.total) {
        staleTimer = setTimeout(() => {
          set({ progress: null, syncOperation: null });
          staleTimer = null;
        }, STALE_100_PERCENT_MS);
      }

      const nextTasks = { ...state.activeTasksById };
      if (nextProgress) {
        const taskId = buildTaskId(nextProgress);
        if (isTaskFinished(nextProgress)) {
          delete nextTasks[taskId];
        } else {
          nextTasks[taskId] = nextProgress;
        }
      }
      const { activeCount, aggregateProgress } = buildAggregates(nextTasks);
      return { progress: nextProgress, activeTasksById: nextTasks, activeCount, aggregateProgress };
    });
  },

  refreshPausedUploadInfo: async () => {
    try {
      const info = await getPausedUploadInfo();
      set({ pausedUploadInfo: info });
    } catch (error) {
      console.error("Failed to fetch paused upload info", error);
    }
  },

  clearPausedUploadInfo: () => set({ pausedUploadInfo: null }),

  upsertTask: (task) =>
    set((state) => {
      const nextTasks = { ...state.activeTasksById };
      const taskId = buildTaskId(task);
      if (isTaskFinished(task)) {
        delete nextTasks[taskId];
      } else {
        nextTasks[taskId] = task;
      }
      const { activeCount, aggregateProgress } = buildAggregates(nextTasks);
      return { activeTasksById: nextTasks, activeCount, aggregateProgress };
    }),

  removeTaskById: (taskId) =>
    set((state) => {
      const nextTasks = { ...state.activeTasksById };
      delete nextTasks[taskId];
      const { activeCount, aggregateProgress } = buildAggregates(nextTasks);
      return { activeTasksById: nextTasks, activeCount, aggregateProgress };
    }),

  removeTaskByOperationId: (operationId) =>
    set((state) => {
      if (!operationId?.trim()) return state;
      const nextTasks = { ...state.activeTasksById };
      delete nextTasks[operationId];
      const { activeCount, aggregateProgress } = buildAggregates(nextTasks);
      const nextProgress = state.progress?.operationId === operationId ? null : state.progress;
      return { activeTasksById: nextTasks, activeCount, aggregateProgress, progress: nextProgress };
    }),

  clearTasksByType: (type) =>
    set((state) => {
      const nextTasks = Object.fromEntries(
        Object.entries(state.activeTasksById).filter(([, task]) => task.type !== type)
      );
      const { activeCount, aggregateProgress } = buildAggregates(nextTasks);
      const nextProgress = state.progress?.type === type ? null : state.progress;
      return { activeTasksById: nextTasks, activeCount, aggregateProgress, progress: nextProgress };
    }),

  hydrateActiveTasks: async () => {
    try {
      const snapshot = await getActiveDownloadsState();
      set((state) => {
        const nextTasks = { ...state.activeTasksById };
        for (const item of snapshot) {
          const task: SyncProgressState = {
            type: item.kind === "upload" ? "upload" : "download",
            operationId: item.id,
            status: item.state as SyncProgressState["status"],
            gameId: item.gameId ?? "unknown",
            filename: item.name,
            loaded: item.loaded,
            total: item.total,
          };
          if (!isTaskFinished(task)) {
            nextTasks[buildTaskId(task)] = task;
          }
        }
        const { activeCount, aggregateProgress } = buildAggregates(nextTasks);
        return { activeTasksById: nextTasks, activeCount, aggregateProgress };
      });
    } catch {
      // Mejor esfuerzo: si no hay snapshot disponible, seguimos con eventos en vivo.
    }
  },
}));

let listenersInitialized = false;

export function initSyncListeners() {
  if (listenersInitialized) return;
  listenersInitialized = true;

  const { setProgress, refreshPausedUploadInfo, hydrateActiveTasks } = useSyncStore.getState();

  refreshPausedUploadInfo();
  hydrateActiveTasks();

  listen<{
    operationId?: string;
    status?: SyncProgressState["status"];
    canPause?: boolean;
    canCancel?: boolean;
    canResume?: boolean;
    strategy?: SyncProgressState["strategy"];
    reasonCode?: string;
    gameId: string;
    filename: string;
    loaded: number;
    total: number;
  }>("sync-upload-progress", (ev) => {
    setProgress({ type: "upload", ...ev.payload });
  });

  listen<{
    operationId?: string;
    status?: SyncProgressState["status"];
    canPause?: boolean;
    canCancel?: boolean;
    canResume?: boolean;
    strategy?: SyncProgressState["strategy"];
    reasonCode?: string;
    gameId: string;
    filename: string;
    loaded: number;
    total: number;
  }>("sync-download-progress", (ev) => {
    setProgress({ type: "download", ...ev.payload });
  });

  listen<{
    operationId?: string;
    status: "completed" | "failed" | "paused" | "cancelled";
    type: "upload" | "download";
    gameId?: string;
    reasonCode?: string;
  }>("sync-operation-terminal", (ev) => {
    const state = useSyncStore.getState();
    state.removeTaskByOperationId(ev.payload.operationId);
    // En batch, backend emite terminal por juego. Si coincide por prefijo, limpiamos task equivalente.
    if (ev.payload.type === "upload" && ev.payload.gameId) {
      state.removeTaskByOperationId(`sync-upload-${ev.payload.gameId}`);
    }
    if (ev.payload.type === "download" && ev.payload.gameId) {
      state.removeTaskByOperationId(`sync-download-${ev.payload.gameId}`);
    }
    if (state.syncOperation?.operationId && state.syncOperation.operationId === ev.payload.operationId) {
      state.setSyncOperation(null);
    }
  });

  listen("sync-upload-done", () => {
    const state = useSyncStore.getState();
    const op = state.syncOperation;
    if (op?.mode !== "batch") {
      state.setProgress((prev) => (prev?.type === "upload" ? null : prev));
      if (op?.operationId) state.removeTaskByOperationId(op.operationId);
      state.setSyncOperation(null);
    }

    if (op?.mode === "single" && op?.gameId) {
      notifyUploadDone(formatGameDisplayName(op.gameId)).catch(() => {});
    }
  });

  listen<{ gameId: string; filename: string; operationId?: string; reasonCode?: string }>(
    "sync-upload-paused",
    (ev) => {
      const state = useSyncStore.getState();
      state.setProgress((prev) => (prev?.type === "upload" ? null : prev));
      state.removeTaskByOperationId(ev.payload.operationId ?? state.syncOperation?.operationId);
      state.setSyncOperation(null);
      useSyncStore.setState({
        pausedUploadInfo: { gameId: ev.payload.gameId, filename: ev.payload.filename },
      });
    }
  );

  listen("sync-download-done", () => {
    const state = useSyncStore.getState();
    const op = state.syncOperation;
    if (op?.mode !== "batch") {
      state.setProgress((prev) => (prev?.type === "download" ? null : prev));
      if (op?.operationId) state.removeTaskByOperationId(op.operationId);
      state.setSyncOperation(null);
    }
    if (op?.mode === "single" && op?.gameId) {
      notifyDownloadDone(formatGameDisplayName(op.gameId)).catch(() => {});
    }
  });

  let lastDryRunGameId: string | null = null;
  let lastDryRunTimestamp = 0;

  listen<StreamingDryRunMetrics>("streaming-dry-run-completed", (ev) => {
    if (ev.payload) {
      lastDryRunGameId = ev.payload.gameId;
      lastDryRunTimestamp = Date.now();
      useStreamingMetricsStore.getState().openMetricsModal(ev.payload);
      notifyStreamingDryRunDone(
        formatGameDisplayName(ev.payload.gameId),
        formatBytes(ev.payload.savedBytes),
        ev.payload.savedPercentage
      ).catch(() => {});
    }
  });

  listen("full-backup-done", () => {
    const state = useSyncStore.getState();
    const op = state.syncOperation;
    state.setProgress((prev) => (prev?.type === "upload" ? null : prev));
    if (op?.operationId) state.removeTaskByOperationId(op.operationId);
    state.setSyncOperation(null);

    const isRecentDryRun = op?.gameId && lastDryRunGameId === op.gameId && Date.now() - lastDryRunTimestamp < 2000;

    if (op?.mode === "single" && op?.gameId && !isRecentDryRun) {
      notifyFullBackupDone(formatGameDisplayName(op.gameId)).catch(() => {});
    }
  });
}
