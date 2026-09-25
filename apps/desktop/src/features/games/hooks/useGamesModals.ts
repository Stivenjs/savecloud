import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ConfiguredGame } from "@savecloud/types";
import { addGame, removeGame, deleteGameFromCloud, scheduleConfigBackupToCloud } from "@services/tauri";
import { toastError, toastSuccess } from "@utils/toast";
import { formatGameDisplayName } from "@/utils/gameImage";
import i18n from "@lib/i18n";

interface UseGamesModalsProps {
  gamesCount: number;
  onRefresh: () => void;
  onInvalidateConfig: () => void;
}

export function useGamesModals({ gamesCount, onRefresh, onInvalidateConfig }: UseGamesModalsProps) {
  const queryClient = useQueryClient();
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [addModalInitial, setAddModalInitial] = useState<{ paths: string[]; suggestedId: string }>({
    paths: [],
    suggestedId: "",
  });
  const [configureFromCloudGameId, setConfigureFromCloudGameId] = useState<string | null>(null);
  const [restoreFromCloudGameId, setRestoreFromCloudGameId] = useState<string | null>(null);
  const [gameToRemove, setGameToRemove] = useState<ConfiguredGame | null>(null);
  const [syncPreviewGame, setSyncPreviewGame] = useState<ConfiguredGame | null>(null);
  const [syncPreviewType, setSyncPreviewType] = useState<"upload" | "download" | null>(null);
  const [gameToRestoreBackup, setGameToRestoreBackup] = useState<ConfiguredGame | null>(null);
  const [bulkConfirm, setBulkConfirm] = useState<{ type: "sync" | "download"; count: number } | null>(null);

  const [trashModalOpen, setTrashModalOpen] = useState(false);

  const handleScanSelect = async (paths: string[], suggestedId: string) => {
    const idToUse = configureFromCloudGameId ?? suggestedId;
    if (configureFromCloudGameId) setConfigureFromCloudGameId(null);
    if (paths.length > 1) {
      await addGame(idToUse, paths);
      scheduleConfigBackupToCloud();
      await new Promise((resolve) => setTimeout(resolve, 150));
      onInvalidateConfig();
      setScanModalOpen(false);
      return;
    }
    setAddModalInitial({ paths: paths.length ? [paths[0]!] : [], suggestedId: idToUse });
    setAddModalOpen(true);
  };

  const handleConfigureFromCloud = (gameId: string) => {
    setConfigureFromCloudGameId(gameId);
    setScanModalOpen(true);
  };

  const handleOpenRestoreFromCloud = useCallback((gameId: string) => {
    setRestoreFromCloudGameId(gameId);
  }, []);

  const handleCloseRestoreFromCloud = useCallback(() => {
    setRestoreFromCloudGameId(null);
  }, []);

  const openScanAssistForCloudRestore = useCallback((gameId: string) => {
    setRestoreFromCloudGameId(null);
    setConfigureFromCloudGameId(gameId);
    setScanModalOpen(true);
  }, []);

  const linkCloudGameFolder = useCallback(
    async (gameId: string, folderPath: string) => {
      const trimmed = folderPath.trim();
      if (!trimmed) {
        throw new Error("La ruta seleccionada está vacía.");
      }
      await addGame(gameId, [trimmed]);
      scheduleConfigBackupToCloud();
      await new Promise((resolve) => setTimeout(resolve, 150));
      onInvalidateConfig();
      onRefresh();
    },
    [onInvalidateConfig, onRefresh]
  );

  const handleRemoveGame = (game: ConfiguredGame) => {
    setGameToRemove(game);
  };

  const handleConfirmRemove = async (gameId: string, permanent?: boolean) => {
    const displayName = formatGameDisplayName(gameId);
    try {
      try {
        await deleteGameFromCloud(gameId, permanent);
        void queryClient.invalidateQueries({ queryKey: ["trash-items"] });
      } catch (e) {
        toastError(i18n.t("library.toast.cannotDeleteCloudSaves"), e instanceof Error ? e.message : String(e));
      }

      await removeGame(gameId);
      scheduleConfigBackupToCloud();
      await new Promise((resolve) => setTimeout(resolve, 150));
      onRefresh();
      setGameToRemove(null);

      if (permanent) {
        toastSuccess(
          i18n.t("library.toast.gameRemovedPermanentlyTitle", "Juego eliminado"),
          i18n.t("library.toast.gameRemovedPermanentlyDesc", { gameName: displayName })
        );
      } else {
        toastSuccess(
          i18n.t("library.toast.gameMovedToTrashTitle", "Juego eliminado"),
          i18n.t("library.toast.gameMovedToTrashDesc", { gameName: displayName })
        );
      }
    } catch (e) {
      console.error("Error al eliminar juego:", e);
      toastError(i18n.t("library.toast.cannotDelete"), e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  const handleConfirmClearCloudSaves = async (gameId: string, permanent?: boolean) => {
    const displayName = formatGameDisplayName(gameId);
    try {
      await deleteGameFromCloud(gameId, permanent);
      void queryClient.invalidateQueries({ queryKey: ["trash-items"] });
      await new Promise((resolve) => setTimeout(resolve, 150));
      onRefresh();
      setGameToRemove(null);

      if (permanent) {
        toastSuccess(
          i18n.t("library.toast.cloudSavesPermanentlyDeletedTitle", "Guardados destruidos"),
          i18n.t("library.toast.cloudSavesPermanentlyDeletedDesc", { gameName: displayName })
        );
      } else {
        toastSuccess(
          i18n.t("library.toast.cloudSavesMovedToTrashTitle", "Guardados en la nube"),
          i18n.t("library.toast.cloudSavesMovedToTrashDesc", { gameName: displayName })
        );
      }
    } catch (e) {
      toastError(i18n.t("library.toast.cannotDeleteCloudSaves"), e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  const handleRestoreBackup = (game: ConfiguredGame) => {
    setGameToRestoreBackup(game);
  };

  const handleCloseRestoreBackup = () => {
    setGameToRestoreBackup(null);
  };

  const handleCloseSyncPreview = () => {
    setSyncPreviewGame(null);
    setSyncPreviewType(null);
  };

  const openSyncAllConfirm = () => {
    if (gamesCount > 0) setBulkConfirm({ type: "sync", count: gamesCount });
  };

  const openDownloadAllConfirm = () => {
    if (gamesCount > 0) setBulkConfirm({ type: "download", count: gamesCount });
  };

  const handleCancelBulkAction = () => {
    setBulkConfirm(null);
  };

  return {
    addModalOpen,
    setAddModalOpen,
    scanModalOpen,
    setScanModalOpen,
    trashModalOpen,
    setTrashModalOpen,
    addModalInitial,
    setAddModalInitial: (initial: { paths: string[]; suggestedId: string }) => {
      setAddModalInitial(initial);
      setAddModalOpen(true);
    },
    configureFromCloudGameId,
    setConfigureFromCloudGameId,
    restoreFromCloudGameId,
    handleOpenRestoreFromCloud,
    handleCloseRestoreFromCloud,
    openScanAssistForCloudRestore,
    linkCloudGameFolder,
    handleScanSelect,
    handleConfigureFromCloud,
    gameToRemove,
    setGameToRemove,
    handleRemoveGame,
    handleConfirmRemove,
    handleConfirmClearCloudSaves,
    syncPreviewGame,
    setSyncPreviewGame,
    syncPreviewType,
    setSyncPreviewType,
    handleCloseSyncPreview,
    gameToRestoreBackup,
    handleRestoreBackup,
    handleCloseRestoreBackup,
    bulkConfirm,
    setBulkConfirm,
    openSyncAllConfirm,
    openDownloadAllConfirm,
    handleCancelBulkAction,
  };
}
