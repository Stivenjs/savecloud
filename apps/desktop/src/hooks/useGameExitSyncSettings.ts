/**
 * @file useGameExitSyncSettings.ts
 * @description Hook de TanStack Query para gestionar la subida automática al salir de un juego.
 * Sigue las mejores prácticas de Vercel React: sin useEffect para data-fetching, mutación con rollback optimista.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAutoSyncOnGameExit, setAutoSyncOnGameExit } from "@services/tauri";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";

export const GAME_EXIT_SYNC_QUERY_KEY = ["auto-sync-on-exit"] as const;

export function useGameExitSyncSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: GAME_EXIT_SYNC_QUERY_KEY,
    queryFn: async () => {
      return getAutoSyncOnGameExit();
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      await setAutoSyncOnGameExit(enabled);
    },
    onMutate: async (newEnabled: boolean) => {
      await queryClient.cancelQueries({ queryKey: GAME_EXIT_SYNC_QUERY_KEY });
      const previousValue = queryClient.getQueryData<boolean>(GAME_EXIT_SYNC_QUERY_KEY);
      queryClient.setQueryData<boolean>(GAME_EXIT_SYNC_QUERY_KEY, newEnabled);
      return { previousValue };
    },
    onError: (_err, _newEnabled, context) => {
      if (context?.previousValue !== undefined) {
        queryClient.setQueryData<boolean>(GAME_EXIT_SYNC_QUERY_KEY, context.previousValue);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: GAME_EXIT_SYNC_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    },
  });

  return {
    autoSyncOnGameExit: query.data ?? true,
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    setAutoSyncOnGameExit: mutation.mutate,
  };
}
