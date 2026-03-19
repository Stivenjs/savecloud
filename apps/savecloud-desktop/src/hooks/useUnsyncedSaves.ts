import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { syncCheckUnsyncedGames, syncUploadGame } from "@services/tauri";
import { useConfig, CONFIG_QUERY_KEY } from "@hooks/useConfig";
import { LAST_SYNC_QUERY_KEY } from "@hooks/useLastSyncInfo";
import { toastSyncResult } from "@utils/toast";
import { formatGameDisplayName } from "@utils/gameImage";

const UNSYNCED_QUERY_KEY = ["unsynced-games"] as const;

export function useUnsyncedSaves() {
  const queryClient = useQueryClient();
  const { config } = useConfig();

  const hasSyncConfig = useMemo(
    () => !!(config?.apiBaseUrl?.trim() && config?.userId?.trim() && config?.apiKey?.trim()),
    [config]
  );

  const {
    data: unsyncedList = [],
    isLoading: isChecking,
    refetch: refetchUnsynced,
  } = useQuery({
    queryKey: UNSYNCED_QUERY_KEY,
    queryFn: syncCheckUnsyncedGames,
    enabled: hasSyncConfig,
    staleTime: 30 * 1000,
  });

  const unsyncedGameIds = useMemo(() => unsyncedList.map((g) => g.gameId), [unsyncedList]);

  const { mutateAsync: uploadAll, isPending: isUploading } = useMutation({
    mutationKey: ["upload-all-unsynced"],
    mutationFn: async () => {
      if (unsyncedGameIds.length === 0) return;

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
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNSYNCED_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: LAST_SYNC_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["game-stats"] });
      queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    },
  });

  const closeModal = useCallback(() => {
    queryClient.setQueryData(UNSYNCED_QUERY_KEY, []);
  }, [queryClient]);

  return {
    unsyncedGameIds,
    isChecking,
    isUploading,
    showUnsyncedModal: unsyncedGameIds.length > 0,
    closeModal,
    uploadAll,
    refetchUnsynced,
  };
}
