import { useCallback, useState, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { useSyncStore } from "@store/SyncStore";
import { useUnsyncedSaves } from "@hooks/useUnsyncedSaves";
import { syncUploadGame, createAndUploadFullBackup } from "@services/tauri";
import { toastError, toastSuccess, toastSyncResult } from "@utils/toast";
import { notifyUploadError, notifyFullBackupError } from "@utils/notification";
import { formatGameDisplayName } from "@utils/gameImage";

const UnsyncedSavesModalLazy = lazy(() =>
  import("@features/games/UnsyncedSavesModal").then((m) => ({ default: m.UnsyncedSavesModal }))
);

export function UnsyncedSavesModalWithProgress() {
  const { t } = useTranslation();
  const setSyncOperation = useSyncStore((state) => state.setSyncOperation);
  const { unsyncedGameIds, showUnsyncedModal, closeModal, uploadAll, isUploading, refetchUnsynced } =
    useUnsyncedSaves();
  const [loadingGameId, setLoadingGameId] = useState<string | null>(null);

  const handleUploadAll = useCallback(async () => {
    setSyncOperation({ type: "upload", mode: "batch", gameId: null, operationId: "sync-upload-batch" });
    try {
      await uploadAll();
    } finally {
      setSyncOperation(null);
    }
  }, [uploadAll, setSyncOperation]);

  const handleUploadGame = useCallback(
    async (gameId: string) => {
      setLoadingGameId(gameId);
      setSyncOperation({ type: "upload", mode: "single", gameId, operationId: `sync-upload-${gameId}` });
      try {
        const result = await syncUploadGame(gameId);
        toastSyncResult(result, formatGameDisplayName(gameId));
        await refetchUnsynced();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toastSyncResult({ okCount: 0, errCount: 1, errors: [msg] }, formatGameDisplayName(gameId));
        notifyUploadError(formatGameDisplayName(gameId), msg).catch(() => {});
      } finally {
        setLoadingGameId(null);
        setSyncOperation(null);
      }
    },
    [refetchUnsynced, setSyncOperation]
  );

  const handleFullBackupGame = useCallback(
    async (gameId: string) => {
      setLoadingGameId(gameId);
      setSyncOperation({ type: "upload", mode: "single", gameId, operationId: `sync-upload-${gameId}` });
      try {
        await createAndUploadFullBackup(gameId);
        toastSuccess(
          t("library.fullBackup.toastSuccessTitle"),
          t("library.fullBackup.toastSuccessDesc", { gameName: formatGameDisplayName(gameId) })
        );
        await refetchUnsynced();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toastError(t("library.fullBackup.toastErrorTitle"), msg);
        notifyFullBackupError(formatGameDisplayName(gameId), msg).catch(() => {});
      } finally {
        setLoadingGameId(null);
        setSyncOperation(null);
      }
    },
    [refetchUnsynced, setSyncOperation, t]
  );

  if (!showUnsyncedModal) return null;

  return (
    <Suspense fallback={null}>
      <UnsyncedSavesModalLazy
        isOpen={showUnsyncedModal}
        onClose={closeModal}
        gameIds={unsyncedGameIds}
        onUploadAll={handleUploadAll}
        onUploadGame={handleUploadGame}
        onFullBackupGame={handleFullBackupGame}
        isLoadingAll={isUploading}
        loadingGameId={loadingGameId}
      />
    </Suspense>
  );
}
