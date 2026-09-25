import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createAndUploadFullBackup, syncDownloadGame, syncUploadGame } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import { toastError, toastSuccess } from "@utils/toast";
import { notifyFullBackupError } from "@utils/notification";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";
import { useSyncStore } from "@store/SyncStore";
import i18n from "@lib/i18n";
import type { ConfiguredGame } from "@app-types/config";

/**
 * Subida/descarga directa y backup completo desde la ficha de detalle:
 * invalidación de caché, toasts y estado de carga para el menú de acciones.
 */
export function useGameDetailCloudActions() {
  const queryClient = useQueryClient();
  const [opLoading, setOpLoading] = useState<"sync" | "download" | null>(null);
  const [fullBackupUploadingGameId, setFullBackupUploadingGameId] = useState<string | null>(null);

  const handleSync = useCallback(
    async (g: ConfiguredGame) => {
      setOpLoading("sync");
      useSyncStore
        .getState()
        .setSyncOperation({ type: "upload", mode: "single", gameId: g.id, operationId: `sync-upload-${g.id}` });
      try {
        await syncUploadGame(g.id);
        toastSuccess(
          i18n.t("library.toast.uploadedTitle"),
          i18n.t("library.toast.uploadedDesc", { gameName: formatGameDisplayName(g.id) })
        );
        await queryClient.invalidateQueries({ queryKey: ["game-stats"] });
        await queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
      } catch (e) {
        toastError(
          i18n.t("library.toast.syncError"),
          e instanceof Error ? e.message : i18n.t("library.toast.unexpectedError")
        );
      } finally {
        setOpLoading(null);
        useSyncStore.getState().setSyncOperation(null);
      }
    },
    [queryClient]
  );

  const handleDownload = useCallback(
    async (g: ConfiguredGame) => {
      setOpLoading("download");
      useSyncStore.getState().setSyncOperation({
        type: "download",
        mode: "single",
        gameId: g.id,
        operationId: `sync-download-${g.id}`,
      });
      try {
        await syncDownloadGame(g.id);
        toastSuccess(
          i18n.t("library.toast.downloadedTitle"),
          i18n.t("library.toast.downloadedDesc", { gameName: formatGameDisplayName(g.id) })
        );
        await queryClient.invalidateQueries({ queryKey: ["game-stats"] });
        await queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      } catch (e) {
        toastError(
          i18n.t("library.toast.downloadError"),
          e instanceof Error ? e.message : i18n.t("library.toast.unexpectedError")
        );
      } finally {
        setOpLoading(null);
        useSyncStore.getState().setSyncOperation(null);
      }
    },
    [queryClient]
  );

  const handleFullBackupUpload = useCallback(
    async (g: ConfiguredGame) => {
      setFullBackupUploadingGameId(g.id);
      useSyncStore
        .getState()
        .setSyncOperation({ type: "upload", mode: "single", gameId: g.id, operationId: `sync-upload-${g.id}` });
      try {
        await createAndUploadFullBackup(g.id);
        toastSuccess(i18n.t("library.toast.fullBackupUploadedTitle"), i18n.t("library.toast.fullBackupUploadedDesc"));
        await queryClient.invalidateQueries({ queryKey: ["game-stats"] });
        await queryClient.invalidateQueries({ queryKey: ["cloud-backups", g.id] });
        await queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
        await queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: ["unsynced-games"] });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toastError(i18n.t("library.toast.fullBackupUploadError"), msg);
        notifyFullBackupError(formatGameDisplayName(g.id), msg).catch(() => {});
      } finally {
        setFullBackupUploadingGameId(null);
        useSyncStore.getState().setSyncOperation(null);
      }
    },
    [queryClient]
  );

  return {
    handleSync,
    handleDownload,
    handleFullBackupUpload,
    isSyncing: opLoading === "sync",
    isDownloading: opLoading === "download",
    fullBackupUploadingGameId,
  };
}
