import { useReducer, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  addGame,
  createAndUploadFullBackup,
  deleteGameFromCloud,
  openSaveFolder,
  removeGame,
  scheduleConfigBackupToCloud,
  syncCheckDownloadConflicts,
  syncCheckDownloadConflictsBatch,
  syncCheckUnsyncedGames,
  syncDownloadAllGames,
  syncDownloadGame,
  syncUploadAllGames,
  syncUploadGame,
  type SyncResult,
} from "@services/tauri";
import type { ConfiguredGame } from "@app-types/config";
import { formatGameDisplayName } from "@utils/gameImage";
import {
  notifyBatchDownloadDone,
  notifyBatchUploadDone,
  notifyDownloadError,
  notifyFullBackupError,
  notifyUploadError,
} from "@utils/notification";
import { toastDownloadResult, toastError, toastSuccess, toastSyncResult } from "@utils/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConfig } from "@hooks/useConfig";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { useLastSyncInfo } from "@hooks/useLastSyncInfo";
import { useSyncProgress } from "@contexts/SyncProgressContext";
import { filterGames, type OriginFilter } from "@features/games/GamesFilters";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";

export interface OperationResult {
  type: "sync" | "download";
  gameId: string;
  result: SyncResult;
}

type DownloadConflictItem = {
  filename: string;
  localModified: string;
  cloudModified: string;
};

type GamesPageState = {
  searchTerm: string;
  originFilter: OriginFilter;
  addModalOpen: boolean;
  scanModalOpen: boolean;
  addModalInitial: { path: string; suggestedId: string };
  configureFromCloudGameId: string | null;
  gameToRemove: ConfiguredGame | null;
  downloadConflictGame: ConfiguredGame | null;
  downloadConflicts: DownloadConflictItem[];
  downloadAllConflictGames: { gameId: string; conflictCount: number }[];
  syncing: string | "all" | null;
  downloading: string | "all" | null;
  fullBackupUploadingGameId: string | null;
  operationResult: OperationResult | null;
  syncPreviewGame: ConfiguredGame | null;
  syncPreviewType: "upload" | "download" | null;
  gameToRestoreBackup: ConfiguredGame | null;
  bulkConfirm: { type: "sync" | "download"; count: number } | null;
  refreshing: boolean;
};

type GamesPageAction =
  | { type: "SET_SEARCH"; payload: string }
  | { type: "SET_ORIGIN_FILTER"; payload: OriginFilter }
  | {
      type: "SET_ADD_MODAL";
      open: boolean;
      initial?: { path: string; suggestedId: string };
    }
  | { type: "SET_SCAN_MODAL"; open: boolean }
  | { type: "SET_CONFIGURE_FROM_CLOUD"; gameId: string | null }
  | { type: "SET_GAME_TO_REMOVE"; game: ConfiguredGame | null }
  | {
      type: "SET_DOWNLOAD_CONFLICT";
      game: ConfiguredGame | null;
      conflicts: DownloadConflictItem[];
    }
  | {
      type: "SET_DOWNLOAD_ALL_CONFLICTS";
      items: { gameId: string; conflictCount: number }[];
    }
  | { type: "SET_SYNCING"; value: string | "all" | null }
  | { type: "SET_DOWNLOADING"; value: string | "all" | null }
  | { type: "SET_FULL_BACKUP_UPLOADING"; gameId: string | null }
  | { type: "SET_OPERATION_RESULT"; value: OperationResult | null }
  | {
      type: "SET_SYNC_PREVIEW";
      game: ConfiguredGame | null;
      previewType: "upload" | "download" | null;
    }
  | { type: "SET_GAME_TO_RESTORE"; game: ConfiguredGame | null }
  | { type: "SET_BULK_CONFIRM"; value: GamesPageState["bulkConfirm"] }
  | { type: "SET_REFRESHING"; payload: boolean };

const initialState: GamesPageState = {
  searchTerm: "",
  originFilter: "all",
  addModalOpen: false,
  scanModalOpen: false,
  addModalInitial: { path: "", suggestedId: "" },
  configureFromCloudGameId: null,
  gameToRemove: null,
  downloadConflictGame: null,
  downloadConflicts: [],
  downloadAllConflictGames: [],
  syncing: null,
  downloading: null,
  fullBackupUploadingGameId: null,
  operationResult: null,
  syncPreviewGame: null,
  syncPreviewType: null,
  gameToRestoreBackup: null,
  bulkConfirm: null,
  refreshing: false,
};

function gamesPageReducer(state: GamesPageState, action: GamesPageAction): GamesPageState {
  switch (action.type) {
    case "SET_SEARCH":
      return { ...state, searchTerm: action.payload };
    case "SET_ORIGIN_FILTER":
      return { ...state, originFilter: action.payload };
    case "SET_ADD_MODAL":
      return {
        ...state,
        addModalOpen: action.open,
        addModalInitial: action.initial ?? state.addModalInitial,
      };
    case "SET_SCAN_MODAL":
      return { ...state, scanModalOpen: action.open };
    case "SET_CONFIGURE_FROM_CLOUD":
      return { ...state, configureFromCloudGameId: action.gameId };
    case "SET_GAME_TO_REMOVE":
      return { ...state, gameToRemove: action.game };
    case "SET_DOWNLOAD_CONFLICT":
      return {
        ...state,
        downloadConflictGame: action.game,
        downloadConflicts: action.conflicts,
      };
    case "SET_DOWNLOAD_ALL_CONFLICTS":
      return { ...state, downloadAllConflictGames: action.items };
    case "SET_SYNCING":
      return { ...state, syncing: action.value };
    case "SET_DOWNLOADING":
      return { ...state, downloading: action.value };
    case "SET_FULL_BACKUP_UPLOADING":
      return { ...state, fullBackupUploadingGameId: action.gameId };
    case "SET_OPERATION_RESULT":
      return { ...state, operationResult: action.value };
    case "SET_SYNC_PREVIEW":
      return {
        ...state,
        syncPreviewGame: action.game,
        syncPreviewType: action.previewType,
      };
    case "SET_GAME_TO_RESTORE":
      return { ...state, gameToRestoreBackup: action.game };
    case "SET_BULK_CONFIRM":
      return { ...state, bulkConfirm: action.value };
    case "SET_REFRESHING":
      return { ...state, refreshing: action.payload };
    default:
      return state;
  }
}

export function useGamesPage() {
  const queryClient = useQueryClient();
  const [state, dispatch] = useReducer(gamesPageReducer, initialState);
  const {
    searchTerm,
    originFilter,
    addModalOpen,
    scanModalOpen,
    addModalInitial,
    configureFromCloudGameId,
    gameToRemove,
    downloadConflictGame,
    downloadConflicts,
    downloadAllConflictGames,
    syncing,
    downloading,
    fullBackupUploadingGameId,
    operationResult,
    syncPreviewGame,
    syncPreviewType,
    gameToRestoreBackup,
    bulkConfirm,
    refreshing,
  } = state;

  const { config, loading, error, refetch } = useConfig();
  const hasSyncConfig = !!(config?.apiBaseUrl?.trim() && config?.userId?.trim() && config?.apiKey?.trim());
  const {
    lastSyncAt,
    lastSyncGameId,
    cloudGames,
    totalCloudSize,
    isLoading: lastSyncLoading,
    connectionStatus,
    connectionError,
    refetch: refetchLastSync,
  } = useLastSyncInfo(hasSyncConfig);

  const { setSyncOperation } = useSyncProgress();

  const { data: unsyncedGames } = useQuery({
    queryKey: ["unsynced-games"],
    queryFn: syncCheckUnsyncedGames,
    enabled: hasSyncConfig,
    refetchInterval: 60_000,
  });
  const unsyncedGameIds = unsyncedGames?.map((g) => g.gameId) ?? [];

  const handleRefresh = useCallback(async () => {
    dispatch({ type: "SET_REFRESHING", payload: true });
    try {
      await Promise.all([
        refetch?.(),
        refetchLastSync?.(),
        queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY, type: "active" }),
        queryClient.invalidateQueries({ queryKey: ["game-stats"], type: "active" }),
        queryClient.invalidateQueries({ queryKey: ["unsynced-games"], type: "active" }),
        queryClient.invalidateQueries({ queryKey: ["last-sync-info"], type: "active" }),
      ]);
    } finally {
      dispatch({ type: "SET_REFRESHING", payload: false });
    }
  }, [refetch, refetchLastSync, queryClient]);

  useEffect(() => {
    let unlistenUpload: (() => void) | undefined;
    let unlistenDownload: (() => void) | undefined;
    let unlistenFullBackup: (() => void) | undefined;

    const setupListeners = async () => {
      const onGlobalSyncEvent = () => {
        handleRefresh();
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
  }, [handleRefresh]);

  const handleDismissOperationError = () => {
    dispatch({ type: "SET_OPERATION_RESULT", value: null });
    handleRefresh();
  };

  const handleRetryOperationError = (gameId: string, opType: "sync" | "download") => {
    dispatch({ type: "SET_OPERATION_RESULT", value: null });
    const game = config?.games?.find((g) => g.id === gameId);
    if (game) {
      dispatch({
        type: "SET_SYNC_PREVIEW",
        game,
        previewType: opType === "sync" ? "upload" : "download",
      });
    }
  };

  const setSearchTerm = (v: string) => dispatch({ type: "SET_SEARCH", payload: v });
  const setOriginFilter = (v: OriginFilter) => dispatch({ type: "SET_ORIGIN_FILTER", payload: v });
  const setAddModalOpen = (open: boolean) => dispatch({ type: "SET_ADD_MODAL", open });
  const setScanModalOpen = (open: boolean) => dispatch({ type: "SET_SCAN_MODAL", open });
  const setAddModalInitial = (initial: { path: string; suggestedId: string }) =>
    dispatch({ type: "SET_ADD_MODAL", open: true, initial });
  const setConfigureFromCloudGameId = (gameId: string | null) => dispatch({ type: "SET_CONFIGURE_FROM_CLOUD", gameId });
  const setGameToRemove = (game: ConfiguredGame | null) => dispatch({ type: "SET_GAME_TO_REMOVE", game });

  const handleScanSelect = async (paths: string[], suggestedId: string) => {
    const idToUse = configureFromCloudGameId ?? suggestedId;
    if (configureFromCloudGameId) dispatch({ type: "SET_CONFIGURE_FROM_CLOUD", gameId: null });
    if (paths.length > 1) {
      for (const path of paths) {
        await addGame(idToUse, path);
      }
      scheduleConfigBackupToCloud();

      await new Promise((resolve) => setTimeout(resolve, 150));

      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      refetch?.();
      dispatch({ type: "SET_SCAN_MODAL", open: false });
      return;
    }
    dispatch({
      type: "SET_ADD_MODAL",
      open: true,
      initial: { path: paths[0] ?? "", suggestedId: idToUse },
    });
  };

  const handleConfigureFromCloud = (gameId: string) => {
    dispatch({ type: "SET_CONFIGURE_FROM_CLOUD", gameId });
    dispatch({ type: "SET_SCAN_MODAL", open: true });
  };

  const handleRemoveGame = (game: ConfiguredGame) => {
    dispatch({ type: "SET_GAME_TO_REMOVE", game });
  };

  const handleConfirmRemove = async (gameId: string) => {
    try {
      try {
        await deleteGameFromCloud(gameId);
      } catch (e) {
        toastError("No se pudieron borrar los guardados en la nube", e instanceof Error ? e.message : String(e));
      }

      await removeGame(gameId);
      scheduleConfigBackupToCloud();

      await new Promise((resolve) => setTimeout(resolve, 150));

      handleRefresh();

      dispatch({ type: "SET_GAME_TO_REMOVE", game: null });
    } catch (e) {
      console.error("Error al eliminar juego:", e);
      throw e;
    }
  };

  const handleSyncOne = (game: ConfiguredGame) => {
    dispatch({ type: "SET_SYNC_PREVIEW", game, previewType: "upload" });
  };

  const handleFullBackupUpload = async (game: ConfiguredGame) => {
    dispatch({ type: "SET_FULL_BACKUP_UPLOADING", gameId: game.id });
    setSyncOperation({ type: "upload", mode: "single", gameId: game.id });
    try {
      await createAndUploadFullBackup(game.id);
      toastSuccess(
        "Backup completo subido",
        "Se empaquetó y subió a la nube. Recomendado para juegos con muchos archivos."
      );
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["cloud-backups", game.id] });
      queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toastError("Error al empaquetar y subir", msg);
      notifyFullBackupError(formatGameDisplayName(game.id), msg).catch(() => {});
    } finally {
      dispatch({ type: "SET_FULL_BACKUP_UPLOADING", gameId: null });

      refetch?.();
      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
    }
  };

  const handleConfirmSyncPreview = async () => {
    if (!syncPreviewGame || !syncPreviewType) return;
    const game = syncPreviewGame;
    if (syncPreviewType === "upload") {
      dispatch({ type: "SET_SYNCING", value: game.id });
      setSyncOperation({ type: "upload", mode: "single", gameId: game.id });
      dispatch({ type: "SET_OPERATION_RESULT", value: null });
      try {
        const result = await syncUploadGame(game.id);
        dispatch({
          type: "SET_OPERATION_RESULT",
          value: { type: "sync", gameId: game.id, result },
        });
        toastSyncResult(result, formatGameDisplayName(game.id));
        dispatch({ type: "SET_SYNC_PREVIEW", game: null, previewType: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const errResult = {
          okCount: 0,
          errCount: 1,
          errors: [msg],
        };
        dispatch({
          type: "SET_OPERATION_RESULT",
          value: { type: "sync", gameId: game.id, result: errResult },
        });
        toastSyncResult(errResult, formatGameDisplayName(game.id));
        notifyUploadError(formatGameDisplayName(game.id), msg).catch(() => {});
        dispatch({ type: "SET_SYNC_PREVIEW", game: null, previewType: null });
      } finally {
        dispatch({ type: "SET_SYNCING", value: null });
        refetchLastSync?.();
        queryClient.invalidateQueries({ queryKey: ["game-stats"] });
        queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });

        refetch?.();
        queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      }
    } else {
      dispatch({ type: "SET_DOWNLOADING", value: game.id });
      setSyncOperation({ type: "download", mode: "single", gameId: game.id });
      try {
        await executeDownload(game);
        dispatch({ type: "SET_SYNC_PREVIEW", game: null, previewType: null });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        notifyDownloadError(formatGameDisplayName(game.id), msg).catch(() => {});
        setSyncOperation(null);
        dispatch({ type: "SET_DOWNLOADING", value: null });
        dispatch({ type: "SET_SYNC_PREVIEW", game: null, previewType: null });
      }
    }
  };

  const executeDownload = async (game: ConfiguredGame) => {
    dispatch({ type: "SET_OPERATION_RESULT", value: null });
    try {
      const result = await syncDownloadGame(game.id);
      dispatch({
        type: "SET_OPERATION_RESULT",
        value: { type: "download", gameId: game.id, result },
      });
      toastDownloadResult(result, formatGameDisplayName(game.id));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const errResult = {
        okCount: 0,
        errCount: 1,
        errors: [msg],
      };
      dispatch({
        type: "SET_OPERATION_RESULT",
        value: { type: "download", gameId: game.id, result: errResult },
      });
      toastDownloadResult(errResult, formatGameDisplayName(game.id));
      notifyDownloadError(formatGameDisplayName(game.id), msg).catch(() => {});
    } finally {
      dispatch({ type: "SET_DOWNLOADING", value: null });
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });

      refetch?.();
      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    }
  };

  const handleDownloadOne = async (game: ConfiguredGame) => {
    try {
      const { conflicts } = await syncCheckDownloadConflicts(game.id);
      if (conflicts.length > 0) {
        dispatch({ type: "SET_DOWNLOAD_CONFLICT", game, conflicts });
        return;
      }
      dispatch({ type: "SET_SYNC_PREVIEW", game, previewType: "download" });
    } catch (e) {
      const errResult = {
        okCount: 0,
        errCount: 1,
        errors: [e instanceof Error ? e.message : String(e)],
      };
      dispatch({
        type: "SET_OPERATION_RESULT",
        value: { type: "download", gameId: game.id, result: errResult },
      });
      toastDownloadResult(errResult, formatGameDisplayName(game.id));
    } finally {
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
    }
  };

  const handleConfirmDownloadConflict = async () => {
    if (!downloadConflictGame) return;
    const game = downloadConflictGame;
    dispatch({ type: "SET_DOWNLOADING", value: game.id });
    setSyncOperation({ type: "download", mode: "single", gameId: game.id });
    try {
      await executeDownload(game);
      dispatch({ type: "SET_DOWNLOAD_CONFLICT", game: null, conflicts: [] });
    } finally {
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
    }
  };

  const handleCloseDownloadConflict = () => {
    dispatch({ type: "SET_DOWNLOAD_CONFLICT", game: null, conflicts: [] });
  };

  const executeSyncAll = async () => {
    if (!config?.games?.length) return;
    dispatch({ type: "SET_SYNCING", value: "all" });
    setSyncOperation({ type: "upload", mode: "batch", gameId: null });
    dispatch({ type: "SET_OPERATION_RESULT", value: null });
    let totalResult = { okCount: 0, errCount: 0, errors: [] as string[] };
    try {
      const results = await syncUploadAllGames();
      totalResult = {
        okCount: results.reduce((s, r) => s + r.result.okCount, 0),
        errCount: results.reduce((s, r) => s + r.result.errCount, 0),
        errors: results.flatMap((r) => r.result.errors),
      };
      dispatch({
        type: "SET_OPERATION_RESULT",
        value: { type: "sync", gameId: "", result: totalResult },
      });
      toastSyncResult(totalResult);
    } catch (e) {
      totalResult = {
        okCount: 0,
        errCount: 1,
        errors: [e instanceof Error ? e.message : String(e)],
      };
      dispatch({
        type: "SET_OPERATION_RESULT",
        value: { type: "sync", gameId: "", result: totalResult },
      });
      toastSyncResult(totalResult);
    } finally {
      setSyncOperation(null);
      notifyBatchUploadDone(totalResult.okCount, totalResult.errCount).catch(() => {});
      dispatch({ type: "SET_SYNCING", value: null });
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });

      refetch?.();
      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    }
  };

  const openSyncAllConfirm = () => {
    const count = config?.games?.length ?? 0;
    if (count > 0) dispatch({ type: "SET_BULK_CONFIRM", value: { type: "sync", count } });
  };

  const openDownloadAllConfirm = () => {
    const count = config?.games?.length ?? 0;
    if (count > 0)
      dispatch({
        type: "SET_BULK_CONFIRM",
        value: { type: "download", count },
      });
  };

  const handleConfirmBulkAction = async () => {
    const pending = bulkConfirm;
    dispatch({ type: "SET_BULK_CONFIRM", value: null });
    if (!pending) return;
    if (pending.type === "sync") await executeSyncAll();
    else await handleDownloadAll();
  };

  const handleCancelBulkAction = () => {
    dispatch({ type: "SET_BULK_CONFIRM", value: null });
  };

  const executeDownloadAll = async () => {
    if (!config?.games?.length) return;
    setSyncOperation({ type: "download", mode: "batch", gameId: null });
    let totalResult = { okCount: 0, errCount: 0, errors: [] as string[] };
    try {
      const results = await syncDownloadAllGames();
      totalResult = {
        okCount: results.reduce((s, r) => s + r.result.okCount, 0),
        errCount: results.reduce((s, r) => s + r.result.errCount, 0),
        errors: results.flatMap((r) => r.result.errors),
      };
      dispatch({
        type: "SET_OPERATION_RESULT",
        value: { type: "download", gameId: "", result: totalResult },
      });
      toastDownloadResult(totalResult);
    } catch (e) {
      totalResult = {
        okCount: 0,
        errCount: 1,
        errors: [e instanceof Error ? e.message : String(e)],
      };
      dispatch({
        type: "SET_OPERATION_RESULT",
        value: { type: "download", gameId: "", result: totalResult },
      });
      toastDownloadResult(totalResult);
    } finally {
      setSyncOperation(null);
      notifyBatchDownloadDone(totalResult.okCount, totalResult.errCount).catch(() => {});
      dispatch({ type: "SET_DOWNLOADING", value: null });
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });

      refetch?.();
      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    }
  };

  const handleDownloadAll = async () => {
    if (!config?.games?.length) return;
    dispatch({ type: "SET_DOWNLOADING", value: "all" });
    dispatch({ type: "SET_OPERATION_RESULT", value: null });
    try {
      const batchResults = await syncCheckDownloadConflictsBatch(config.games.map((g) => g.id));
      const gamesWithConflicts: { gameId: string; conflictCount: number }[] = batchResults
        .filter((r) => r.conflicts.length > 0)
        .map((r) => ({
          gameId: r.gameId,
          conflictCount: r.conflicts.length,
        }));
      if (gamesWithConflicts.length > 0) {
        dispatch({
          type: "SET_DOWNLOAD_ALL_CONFLICTS",
          items: gamesWithConflicts,
        });
        dispatch({ type: "SET_DOWNLOADING", value: null });
        return;
      }
      await executeDownloadAll();
    } catch (e) {
      const errResult = {
        okCount: 0,
        errCount: 1,
        errors: [e instanceof Error ? e.message : String(e)],
      };
      dispatch({
        type: "SET_OPERATION_RESULT",
        value: { type: "download", gameId: "", result: errResult },
      });
      toastDownloadResult(errResult);
      dispatch({ type: "SET_DOWNLOADING", value: null });
    } finally {
      refetchLastSync?.();
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
    }
  };

  const handleConfirmDownloadAllConflict = async () => {
    dispatch({ type: "SET_DOWNLOADING", value: "all" });
    try {
      await executeDownloadAll();
      dispatch({ type: "SET_DOWNLOAD_ALL_CONFLICTS", items: [] });
    } finally {
      refetchLastSync?.();
    }
  };

  const handleCloseDownloadAllConflict = () => {
    dispatch({ type: "SET_DOWNLOAD_ALL_CONFLICTS", items: [] });
  };

  const handleCloseSyncPreview = () => {
    dispatch({ type: "SET_SYNC_PREVIEW", game: null, previewType: null });
  };

  const handleRestoreBackup = (game: ConfiguredGame) => {
    dispatch({ type: "SET_GAME_TO_RESTORE", game });
  };

  const handleCloseRestoreBackup = () => {
    dispatch({ type: "SET_GAME_TO_RESTORE", game: null });
  };

  const handleOpenFolder = async (game: ConfiguredGame) => {
    try {
      await openSaveFolder(game.id);
    } catch (e) {
      toastError("No se pudo abrir", e instanceof Error ? e.message : String(e));
    }
  };

  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const filteredGames = filterGames(config?.games ?? [], debouncedSearchTerm, originFilter);
  const hasConfiguredGames = (config?.games?.length ?? 0) > 0;
  const hasCloudGames = cloudGames.length > 0;
  const emptyFilterMessage =
    hasConfiguredGames && (debouncedSearchTerm !== "" || originFilter !== "all")
      ? "No se encontraron juegos con los filtros aplicados."
      : !hasConfiguredGames && hasCloudGames
        ? "No hay juegos configurados, pero tienes guardados en la nube. Añade de nuevo cada juego con el mismo identificador y la ruta local para poder descargar sus backups."
        : undefined;

  return {
    config,
    loading,
    error,
    refetch,
    hasSyncConfig,
    lastSyncAt,
    lastSyncGameId,
    cloudGames,
    totalCloudSize,
    lastSyncLoading,
    connectionStatus,
    connectionError,
    searchTerm,
    setSearchTerm,
    originFilter,
    setOriginFilter,
    debouncedSearchTerm,
    addModalOpen,
    setAddModalOpen,
    scanModalOpen,
    setScanModalOpen,
    setConfigureFromCloudGameId,
    addModalInitial,
    setAddModalInitial,
    gameToRemove,
    setGameToRemove,
    downloadConflictGame,
    downloadConflicts,
    handleConfirmDownloadConflict,
    handleCloseDownloadConflict,
    downloadAllConflictGames,
    handleConfirmDownloadAllConflict,
    handleCloseDownloadAllConflict,
    syncing,
    downloading,
    fullBackupUploadingGameId,
    operationResult,
    handleScanSelect,
    handleConfigureFromCloud,
    handleRemoveGame,
    handleConfirmRemove,
    handleSyncOne,
    handleDownloadOne,
    handleFullBackupUpload,
    syncPreviewGame,
    syncPreviewType,
    handleConfirmSyncPreview,
    handleCloseSyncPreview,
    gameToRestoreBackup,
    handleRestoreBackup,
    handleCloseRestoreBackup,
    bulkConfirm,
    handleConfirmBulkAction,
    handleCancelBulkAction,
    openSyncAllConfirm,
    openDownloadAllConfirm,
    handleOpenFolder,
    handleRefresh,
    refreshing,
    refetchLastSync,
    filteredGames,
    emptyFilterMessage,
    unsyncedGameIds,
    handleDismissOperationError,
    handleRetryOperationError,
  };
}
