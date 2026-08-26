import { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { syncCheckUnsyncedGames, syncUploadGame, type UnsyncedGame } from "@services/tauri";
import { useConfig, CONFIG_QUERY_KEY } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { LAST_SYNC_QUERY_KEY } from "@hooks/useLastSyncInfo";
import { toastInfo, toastSyncResult } from "@utils/toast";
import { formatGameDisplayName } from "@utils/gameImage";
import { hasUsableCloudConnection } from "@utils/cloudConnection";
import { buildActiveCloudConfig } from "@utils/activeCloudConfig";
import i18n from "@lib/i18n";

const UNSYNCED_QUERY_KEY = ["unsynced-games"] as const;

export function useUnsyncedSaves() {
  const queryClient = useQueryClient();
  const { config } = useConfig();
  const { activeProfile } = useProfileSession();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const hasNotifiedRef = useRef(false);

  const cloudConfig = useMemo(() => buildActiveCloudConfig(config, activeProfile), [config, activeProfile]);

  const hasSyncConfig = useMemo(() => hasUsableCloudConnection(cloudConfig), [cloudConfig]);

  const {
    data: unsyncedList = [],
    isLoading: isChecking,
    refetch: refetchUnsynced,
  } = useQuery({
    queryKey: UNSYNCED_QUERY_KEY,
    queryFn: syncCheckUnsyncedGames,
    enabled: hasSyncConfig,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  const unsyncedGameIds = useMemo(() => unsyncedList.map((g: UnsyncedGame) => g.gameId), [unsyncedList]);

  useEffect(() => {
    if (unsyncedGameIds.length > 0 && !hasNotifiedRef.current) {
      hasNotifiedRef.current = true;
      const gameTitle = formatGameDisplayName(unsyncedGameIds[0]);
      const desc =
        unsyncedGameIds.length === 1
          ? i18n.t("library.unsyncedSaves.desc_one", { gameName: gameTitle })
          : i18n.t("library.unsyncedSaves.desc_other", { count: unsyncedGameIds.length });

      toastInfo(i18n.t("library.unsyncedSaves.title"), desc);
    } else if (unsyncedGameIds.length === 0) {
      hasNotifiedRef.current = false;
      setIsModalOpen(false);
    }
  }, [unsyncedGameIds]);

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

  const openModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  return {
    unsyncedGameIds,
    isChecking,
    isUploading,
    showUnsyncedModal: isModalOpen,
    openModal,
    closeModal,
    uploadAll,
    refetchUnsynced,
  };
}
