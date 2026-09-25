/**
 * @file useTorrentSettings.ts
 * @description Hook de TanStack Query para gestionar límites de ancho de banda y modo de seeding.
 * Sigue estrictamente vercel-react-best-practices: sin useEffects innecesarios, mutaciones reactivas.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getTorrentRateLimits,
  setTorrentRateLimits,
  getTorrentSeedingMode,
  setTorrentSeedingMode,
  type TorrentRateLimits,
  type TorrentSeedingMode,
} from "@services/tauri";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";

export const TORRENT_SETTINGS_QUERY_KEY = ["torrent-settings"] as const;

export function useTorrentSettings() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: TORRENT_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const [rateLimits, seedingMode] = await Promise.all([getTorrentRateLimits(), getTorrentSeedingMode()]);
      return {
        rateLimits,
        seedingMode,
      };
    },
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });

  const rateLimitsMutation = useMutation({
    mutationFn: async (limits: TorrentRateLimits) => {
      await setTorrentRateLimits(limits);
    },
    onMutate: async (newLimits: TorrentRateLimits) => {
      await queryClient.cancelQueries({ queryKey: TORRENT_SETTINGS_QUERY_KEY });
      const previous = queryClient.getQueryData<{
        rateLimits: TorrentRateLimits;
        seedingMode: TorrentSeedingMode;
      }>(TORRENT_SETTINGS_QUERY_KEY);

      if (previous) {
        queryClient.setQueryData(TORRENT_SETTINGS_QUERY_KEY, {
          ...previous,
          rateLimits: newLimits,
        });
      }
      return { previous };
    },
    onError: (_err, _newLimits, context) => {
      if (context?.previous) {
        queryClient.setQueryData(TORRENT_SETTINGS_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: TORRENT_SETTINGS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    },
  });

  const seedingModeMutation = useMutation({
    mutationFn: async (mode: TorrentSeedingMode) => {
      await setTorrentSeedingMode(mode);
    },
    onMutate: async (newMode: TorrentSeedingMode) => {
      await queryClient.cancelQueries({ queryKey: TORRENT_SETTINGS_QUERY_KEY });
      const previous = queryClient.getQueryData<{
        rateLimits: TorrentRateLimits;
        seedingMode: TorrentSeedingMode;
      }>(TORRENT_SETTINGS_QUERY_KEY);

      if (previous) {
        queryClient.setQueryData(TORRENT_SETTINGS_QUERY_KEY, {
          ...previous,
          seedingMode: newMode,
        });
      }
      return { previous };
    },
    onError: (_err, _newMode, context) => {
      if (context?.previous) {
        queryClient.setQueryData(TORRENT_SETTINGS_QUERY_KEY, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: TORRENT_SETTINGS_QUERY_KEY });
      void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    },
  });

  return {
    rateLimits: query.data?.rateLimits ?? { downloadLimitKbs: null, uploadLimitKbs: null },
    seedingMode: query.data?.seedingMode ?? "stop_on_complete",
    isLoading: query.isLoading,
    isSavingLimits: rateLimitsMutation.isPending,
    isSavingSeeding: seedingModeMutation.isPending,
    updateRateLimits: rateLimitsMutation.mutate,
    updateSeedingMode: seedingModeMutation.mutate,
  };
}
