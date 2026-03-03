import { useCallback, useEffect, useState } from "react";
import {
  syncCheckUnsyncedGames,
  syncUploadGame,
} from "@services/tauri";
import { useConfig } from "@hooks/useConfig";
import { useLastSyncInfo } from "@hooks/useLastSyncInfo";
import { toastSyncResult } from "@utils/toast";
import { formatGameDisplayName } from "@utils/gameImage";

export function useUnsyncedSaves() {
  const { config } = useConfig();
  const hasSyncConfig = !!(
    config?.apiBaseUrl?.trim() &&
    config?.userId?.trim() &&
    config?.apiKey?.trim()
  );

  const { refetch: refetchLastSync } = useLastSyncInfo(!!hasSyncConfig);
  const [unsyncedGameIds, setUnsyncedGameIds] = useState<string[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const check = useCallback(async () => {
    if (!hasSyncConfig) return;
    setIsChecking(true);
    try {
      const list = await syncCheckUnsyncedGames();
      setUnsyncedGameIds(list.map((g) => g.gameId));
    } catch {
      setUnsyncedGameIds([]);
    } finally {
      setIsChecking(false);
    }
  }, [hasSyncConfig]);

  useEffect(() => {
    check();
  }, [check]);

  useEffect(() => {
    if (!hasSyncConfig) return;
    const onVisible = () => {
      check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [hasSyncConfig, check]);

  const closeModal = useCallback(() => {
    setUnsyncedGameIds([]);
  }, []);

  const uploadAll = useCallback(async () => {
    if (unsyncedGameIds.length === 0) return;
    setIsUploading(true);
    try {
      for (const gameId of unsyncedGameIds) {
        try {
          const result = await syncUploadGame(gameId);
          toastSyncResult(result, formatGameDisplayName(gameId));
        } catch (e) {
          toastSyncResult(
            {
              okCount: 0,
              errCount: 1,
              errors: [e instanceof Error ? e.message : String(e)],
            },
            formatGameDisplayName(gameId)
          );
        }
      }
      setUnsyncedGameIds([]);
      refetchLastSync?.();
    } finally {
      setIsUploading(false);
    }
  }, [unsyncedGameIds, refetchLastSync]);

  return {
    unsyncedGameIds,
    isChecking,
    isUploading,
    showUnsyncedModal: unsyncedGameIds.length > 0,
    closeModal,
    uploadAll,
  };
}
