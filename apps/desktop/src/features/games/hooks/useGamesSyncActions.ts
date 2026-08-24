import { useState, useEffect, useCallback, useRef, startTransition } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  createAndUploadFullBackup,
  openSaveFolder,
  syncCheckDownloadConflicts,
  syncCheckDownloadConflictsBatch,
  syncCheckUnsyncedGames,
  syncDownloadAllGames,
  syncDownloadGame,
  syncUploadAllGames,
  syncUploadGame,
  type SyncResult,
  type UnsyncedGame,
} from "@services/tauri";
import type { ConfiguredGame, Config } from "@savecloud/types";
import { formatGameDisplayName, findConfiguredGame } from "@utils/gameImage";
import {
  notifyBatchDownloadDone,
  notifyBatchUploadDone,
  notifyDownloadError,
  notifyFullBackupError,
  notifyUploadError,
} from "@utils/notification";
import { toastDownloadResult, toastError, toastSuccess, toastSyncResult } from "@utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncStore } from "@store/SyncStore";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";
import { GAMIFICATION_QUERY_KEY } from "@hooks/useGamification";
import i18n from "@lib/i18n";

export interface OperationResult {
  type: "sync" | "download";
  gameId: string;
  result: SyncResult;
}

export interface DownloadConflictItem {
  filename: string;
  localModified: string;
  cloudModified: string;
}

interface UseGamesSyncActionsProps {
  config: Config | null | undefined;
  hasSyncConfig: boolean;
  refetchConfig?: () => Promise<unknown> | void;
  refetchLastSync?: () => void;
  syncPreviewGame: ConfiguredGame | null;
  syncPreviewType: "upload" | "download" | null;
  setSyncPreview: (game: ConfiguredGame | null, type: "upload" | "download" | null) => void;
  bulkConfirm: { type: "sync" | "download"; count: number } | null;
  setBulkConfirm: (v: { type: "sync" | "download"; count: number } | null) => void;
}

export function useGamesSyncActions({
  config,
  hasSyncConfig,
  refetchConfig,
  refetchLastSync,
  syncPreviewGame,
  syncPreviewType,
  setSyncPreview,
  bulkConfirm,
  setBulkConfirm,
}: UseGamesSyncActionsProps) {
  const queryClient = useQueryClient();
  const setSyncOperation = useSyncStore((state) => state.setSyncOperation);

  const [syncing, setSyncing] = useState<string | "all" | null>(null);
  const [downloading, setDownloading] = useState<string | "all" | null>(null);
  const [fullBackupUploadingGameId, setFullBackupUploadingGameId] = useState<string | null>(null);
  const [operationResult, setOperationResult] = useState<OperationResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [downloadConflictGame, setDownloadConflictGame] = useState<ConfiguredGame | null>(null);
  const [downloadConflicts, setDownloadConflicts] = useState<DownloadConflictItem[]>([]);
  const [downloadAllConflictGames, setDownloadAllConflictGames] = useState<{ gameId: string; conflictCount: number }[]>(
    []
  );

  const { data: unsyncedGames } = useQuery({
    queryKey: ["unsynced-games"],
    queryFn: syncCheckUnsyncedGames,
    enabled: hasSyncConfig,
    refetchInterval: 60_000,
  });
  const unsyncedGameIds = unsyncedGames?.map((g: UnsyncedGame) => g.gameId) ?? [];

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchConfig?.(),
        refetchLastSync?.(),
        queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY, type: "active" }),
        queryClient.invalidateQueries({ queryKey: ["game-stats"], type: "active" }),
        queryClient.invalidateQueries({ queryKey: ["unsynced-games"], type: "active" }),
        queryClient.invalidateQueries({ queryKey: ["last-sync-info"], type: "active" }),
        queryClient.invalidateQueries({ queryKey: GAMIFICATION_QUERY_KEY, type: "active" }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetchConfig, refetchLastSync, queryClient]);

  const handleRefreshRef = useRef(handleRefresh);
  useEffect(() => {
    handleRefreshRef.current = handleRefresh;
  }, [handleRefresh]);

  useEffect(() => {
    let unlistenUpload: (() => void) | undefined;
    let unlistenDownload: (() => void) | undefined;
    let unlistenFullBackup: (() => void) | undefined;

    const setupListeners = async () => {
      const onGlobalSyncEvent = () => {
        handleRefreshRef.current();
      };

      unlistenUpload = await listen("sync-upload-done", onGlobalSyncEvent);
      unlistenDownload = await listen("sync-download-done", onGlobalSyncEvent);
      unlistenFullBackup = await listen("full-backup-done", onGlobalSyncEvent);
    };

    setupListeners();

    return () => {
      if (unlistenUpload) unlistenUpload();
      if (unlistenDownload) unlistenDownload();
      if (unlistenFullBackup) unlistenFullBackup();
    };
  }, []);

  const handleDismissOperationError = () => {
    setOperationResult(null);
    handleRefresh();
  };

  const handleRetryOperationError = (gameId: string, opType: "sync" | "download") => {
    setOperationResult(null);
    const game = findConfiguredGame(config?.games, gameId);
    if (game) {
      setSyncPreview(game, opType === "sync" ? "upload" : "download");
    }
  };

  const handleSyncOne = (game: ConfiguredGame) => {
    setSyncPreview(game, "upload");
  };

  const handleFullBackupUpload = async (game: ConfiguredGame) => {
    setFullBackupUploadingGameId(game.id);
    setSyncOperation({ type: "upload", mode: "single", gameId: game.id, operationId: `sync-upload-${game.id}` });
    try {
      await createAndUploadFullBackup(game.id);
      toastSuccess(i18n.t("library.toast.fullBackupUploadedTitle"), i18n.t("library.toast.fullBackupUploadedDesc"));
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["cloud-backups", game.id] });
      queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toastError(i18n.t("library.toast.fullBackupUploadError"), msg);
      notifyFullBackupError(formatGameDisplayName(game.id), msg).catch(() => {});
    } finally {
      setFullBackupUploadingGameId(null);
      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
    }
  };

  const executeDownload = async (game: ConfiguredGame) => {
    setOperationResult(null);
    try {
      const result = await syncDownloadGame(game.id);
      setOperationResult({ type: "download", gameId: game.id, result });
      toastDownloadResult(result, formatGameDisplayName(game.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const errResult = { okCount: 0, errCount: 1, errors: [msg] };
      setOperationResult({ type: "download", gameId: game.id, result: errResult });
      toastDownloadResult(errResult, formatGameDisplayName(game.id));
      notifyDownloadError(formatGameDisplayName(game.id), msg).catch(() => {});
    } finally {
      setDownloading(null);
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    }
  };

  const handleDownloadOne = async (game: ConfiguredGame) => {
    try {
      const { conflicts } = await syncCheckDownloadConflicts(game.id);
      if (conflicts.length > 0) {
        setDownloadConflictGame(game);
        setDownloadConflicts(conflicts);
        return;
      }
      setSyncPreview(game, "download");
    } catch (e) {
      const errResult = {
        okCount: 0,
        errCount: 1,
        errors: [e instanceof Error ? e.message : String(e)],
      };
      setOperationResult({ type: "download", gameId: game.id, result: errResult });
      toastDownloadResult(errResult, formatGameDisplayName(game.id));
    } finally {
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
    }
  };

  const restoreWizardTriggerDownload = (gameId: string) => {
    const game = findConfiguredGame(config?.games, gameId);
    if (!game) {
      toastError(i18n.t("library.toast.gameNotFoundAfterLink"), i18n.t("library.toast.gameNotFoundAfterLinkDesc"));
      return;
    }
    startTransition(() => {
      void handleDownloadOne(game);
    });
  };

  const handleConfirmDownloadConflict = async () => {
    if (!downloadConflictGame) return;
    const game = downloadConflictGame;
    setDownloading(game.id);
    setSyncOperation({
      type: "download",
      mode: "single",
      gameId: game.id,
      operationId: `sync-download-${game.id}`,
    });
    try {
      await executeDownload(game);
      setDownloadConflictGame(null);
      setDownloadConflicts([]);
    } finally {
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
    }
  };

  const handleCloseDownloadConflict = () => {
    setDownloadConflictGame(null);
    setDownloadConflicts([]);
  };

  const handleConfirmSyncPreview = async () => {
    if (!syncPreviewGame || !syncPreviewType) return;
    const game = syncPreviewGame;
    if (syncPreviewType === "upload") {
      setSyncing(game.id);
      setSyncOperation({ type: "upload", mode: "single", gameId: game.id, operationId: `sync-upload-${game.id}` });
      setOperationResult(null);
      try {
        const result = await syncUploadGame(game.id);
        setOperationResult({ type: "sync", gameId: game.id, result });
        toastSyncResult(result, formatGameDisplayName(game.id));
        setSyncPreview(null, null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const errResult = { okCount: 0, errCount: 1, errors: [msg] };
        setOperationResult({ type: "sync", gameId: game.id, result: errResult });
        toastSyncResult(errResult, formatGameDisplayName(game.id));
        notifyUploadError(formatGameDisplayName(game.id), msg).catch(() => {});
        setSyncPreview(null, null);
      } finally {
        setSyncing(null);
        refetchLastSync?.();
        queryClient.invalidateQueries({ queryKey: ["game-stats"] });
        queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
        refetchConfig?.();
        queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      }
    } else {
      setDownloading(game.id);
      setSyncOperation({
        type: "download",
        mode: "single",
        gameId: game.id,
        operationId: `sync-download-${game.id}`,
      });
      try {
        await executeDownload(game);
        setSyncPreview(null, null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notifyDownloadError(formatGameDisplayName(game.id), msg).catch(() => {});
        setSyncOperation(null);
        setDownloading(null);
        setSyncPreview(null, null);
      }
    }
  };

  const executeSyncAll = async () => {
    if (!config?.games?.length) return;
    setSyncing("all");
    setSyncOperation({ type: "upload", mode: "batch", gameId: null, operationId: "sync-upload-batch" });
    setOperationResult(null);
    let totalResult = { okCount: 0, errCount: 0, errors: [] as string[] };
    try {
      const results = await syncUploadAllGames();
      totalResult = {
        okCount: results.reduce((s, r) => s + r.result.okCount, 0),
        errCount: results.reduce((s, r) => s + r.result.errCount, 0),
        errors: results.flatMap((r) => r.result.errors),
      };
      setOperationResult({ type: "sync", gameId: "", result: totalResult });
      toastSyncResult(totalResult);
    } catch (e) {
      totalResult = {
        okCount: 0,
        errCount: 1,
        errors: [e instanceof Error ? e.message : String(e)],
      };
      setOperationResult({ type: "sync", gameId: "", result: totalResult });
      toastSyncResult(totalResult);
    } finally {
      setSyncOperation(null);
      notifyBatchUploadDone(totalResult.okCount, totalResult.errCount).catch(() => {});
      setSyncing(null);
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    }
  };

  const executeDownloadAll = async () => {
    if (!config?.games?.length) return;
    setSyncOperation({ type: "download", mode: "batch", gameId: null, operationId: "sync-download-batch" });
    let totalResult = { okCount: 0, errCount: 0, errors: [] as string[] };
    try {
      const results = await syncDownloadAllGames();
      totalResult = {
        okCount: results.reduce((s, r) => s + r.result.okCount, 0),
        errCount: results.reduce((s, r) => s + r.result.errCount, 0),
        errors: results.flatMap((r) => r.result.errors),
      };
      setOperationResult({ type: "download", gameId: "", result: totalResult });
      toastDownloadResult(totalResult);
    } catch (e) {
      totalResult = {
        okCount: 0,
        errCount: 1,
        errors: [e instanceof Error ? e.message : String(e)],
      };
      setOperationResult({ type: "download", gameId: "", result: totalResult });
      toastDownloadResult(totalResult);
    } finally {
      setSyncOperation(null);
      notifyBatchDownloadDone(totalResult.okCount, totalResult.errCount).catch(() => {});
      setDownloading(null);
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    }
  };

  const handleDownloadAll = async () => {
    if (!config?.games?.length) return;
    setDownloading("all");
    setOperationResult(null);
    try {
      const batchResults = await syncCheckDownloadConflictsBatch(config.games.map((g: ConfiguredGame) => g.id));
      const gamesWithConflicts = batchResults
        .filter((r) => r.conflicts.length > 0)
        .map((r) => ({
          gameId: r.gameId,
          conflictCount: r.conflicts.length,
        }));
      if (gamesWithConflicts.length > 0) {
        setDownloadAllConflictGames(gamesWithConflicts);
        setDownloading(null);
        return;
      }
      await executeDownloadAll();
    } catch (e) {
      const errResult = {
        okCount: 0,
        errCount: 1,
        errors: [e instanceof Error ? e.message : String(e)],
      };
      setOperationResult({ type: "download", gameId: "", result: errResult });
      toastDownloadResult(errResult);
      setDownloading(null);
    } finally {
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
    }
  };

  const handleConfirmDownloadAllConflict = async () => {
    setDownloading("all");
    try {
      await executeDownloadAll();
      setDownloadAllConflictGames([]);
    } finally {
      refetchLastSync?.();
    }
  };

  const handleCloseDownloadAllConflict = () => {
    setDownloadAllConflictGames([]);
  };

  const handleConfirmBulkAction = async () => {
    const pending = bulkConfirm;
    setBulkConfirm(null);
    if (!pending) return;
    if (pending.type === "sync") await executeSyncAll();
    else await handleDownloadAll();
  };

  const handleOpenFolder = async (game: ConfiguredGame) => {
    try {
      await openSaveFolder(game.id);
    } catch (e) {
      toastError(i18n.t("library.toast.cannotOpenFolder"), e instanceof Error ? e.message : String(e));
    }
  };

  return {
    syncing,
    downloading,
    fullBackupUploadingGameId,
    operationResult,
    refreshing,
    unsyncedGameIds,
    downloadConflictGame,
    downloadConflicts,
    handleConfirmDownloadConflict,
    handleCloseDownloadConflict,
    downloadAllConflictGames,
    handleConfirmDownloadAllConflict,
    handleCloseDownloadAllConflict,
    handleRefresh,
    handleDismissOperationError,
    handleRetryOperationError,
    handleSyncOne,
    handleDownloadOne,
    handleFullBackupUpload,
    handleConfirmSyncPreview,
    handleConfirmBulkAction,
    handleOpenFolder,
    restoreWizardTriggerDownload,
  };
}
