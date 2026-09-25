import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { useSyncStore } from "@store/SyncStore";
import { getConfig, syncDownloadAllGames, syncUploadAllGames, createAndUploadFullBackup } from "@services/tauri";
import { toastDownloadResult, toastError, toastSuccess, toastSyncResult } from "@utils/toast";
import {
  notifyBatchDownloadDone,
  notifyBatchUploadDone,
  notifyFullBackupDone,
  notifyFullBackupError,
} from "@utils/notification";
import { formatGameDisplayName } from "@utils/gameImage";
import { useTranslation } from "react-i18next";

export function TrayActionsListener() {
  const { t } = useTranslation();
  const setSyncOperation = useSyncStore((state) => state.setSyncOperation);
  const queryClient = useQueryClient();

  useEffect(() => {
    const unsubUpload = listen("tray-action-upload-all", async () => {
      setSyncOperation({ type: "upload", mode: "batch", gameId: null, operationId: "sync-upload-batch" });
      let totalResult = { okCount: 0, errCount: 0, errors: [] as string[] };
      try {
        const results = await syncUploadAllGames();
        totalResult = {
          okCount: results.reduce((s, r) => s + r.result.okCount, 0),
          errCount: results.reduce((s, r) => s + r.result.errCount, 0),
          errors: results.flatMap((r) => r.result.errors),
        };
        toastSyncResult(totalResult);
      } catch (e) {
        totalResult = {
          okCount: 0,
          errCount: 1,
          errors: [e instanceof Error ? e.message : String(e)],
        };
        toastSyncResult(totalResult);
      } finally {
        setSyncOperation(null);
        notifyBatchUploadDone(totalResult.okCount, totalResult.errCount).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      }
    });

    const unsubDownload = listen("tray-action-download-all", async () => {
      setSyncOperation({ type: "download", mode: "batch", gameId: null, operationId: "sync-download-batch" });
      let totalResult = { okCount: 0, errCount: 0, errors: [] as string[] };
      try {
        const results = await syncDownloadAllGames();
        totalResult = {
          okCount: results.reduce((s, r) => s + r.result.okCount, 0),
          errCount: results.reduce((s, r) => s + r.result.errCount, 0),
          errors: results.flatMap((r) => r.result.errors),
        };
        toastDownloadResult(totalResult);
      } catch (e) {
        totalResult = {
          okCount: 0,
          errCount: 1,
          errors: [e instanceof Error ? e.message : String(e)],
        };
        toastDownloadResult(totalResult);
      } finally {
        setSyncOperation(null);
        notifyBatchDownloadDone(totalResult.okCount, totalResult.errCount).catch(() => {});
        queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      }
    });

    const unsubBackup = listen("tray-action-backup-first", async () => {
      let config;
      try {
        config = await getConfig();
      } catch {
        toastError(t("common.error"), t("tray.readConfigError"));
        return;
      }
      const firstGameId = config?.games?.[0]?.id;
      if (!firstGameId) {
        toastError(t("tray.noGamesTitle"), t("tray.noGamesDesc"));
        return;
      }
      setSyncOperation({
        type: "upload",
        mode: "single",
        gameId: firstGameId,
        operationId: `sync-upload-${firstGameId}`,
      });
      try {
        await createAndUploadFullBackup(firstGameId);
        toastSuccess(
          t("tray.backupSuccessTitle"),
          t("tray.backupSuccessDesc", { gameName: formatGameDisplayName(firstGameId) })
        );
        notifyFullBackupDone(formatGameDisplayName(firstGameId)).catch(() => {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toastError(t("tray.backupErrorTitle"), msg);
        notifyFullBackupError(formatGameDisplayName(firstGameId), msg).catch(() => {});
      } finally {
        setSyncOperation(null);
        queryClient.invalidateQueries({ queryKey: ["game-stats"] });
        queryClient.invalidateQueries({
          queryKey: ["cloud-backups", firstGameId],
        });
        queryClient.invalidateQueries({ queryKey: ["cloud-backup-counts"] });
      }
    });

    return () => {
      unsubUpload.then((f) => f());
      unsubDownload.then((f) => f());
      unsubBackup.then((f) => f());
    };
  }, [setSyncOperation, queryClient, t]);

  return null;
}
