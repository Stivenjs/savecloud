import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getSteamAppDetails } from "@services/tauri";
import { preloadGameDetailModule } from "@features/game-detail/gameDetailLazy";

/** Evita prefetch al pasar el cursor rápido por muchas tarjetas. */
const HOVER_DEBOUNCE_MS = 280;

/** Alineado con `useGameDetail` (steam-app-details). */
const STEAM_DETAILS_STALE_MS = 10 * 60_000;
const STEAM_DETAILS_GC_MS = 60 * 60_000;

/**
 * Prefetch inteligente al hover: debounce + TanStack Query.
 * `prefetchQuery` deduplica peticiones en curso y no refetch si la data sigue fresca (`staleTime`).
 */
export function useGameDetailHoverPrefetch(steamAppId: string | null) {
  const queryClient = useQueryClient();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelScheduledPrefetch = useCallback(() => {
    if (timeoutRef.current != null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const schedulePrefetch = useCallback(() => {
    cancelScheduledPrefetch();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      void preloadGameDetailModule();
      if (steamAppId) {
        void queryClient.prefetchQuery({
          queryKey: ["steam-app-details", steamAppId],
          queryFn: () => getSteamAppDetails(steamAppId),
          staleTime: STEAM_DETAILS_STALE_MS,
          gcTime: STEAM_DETAILS_GC_MS,
        });
      }
    }, HOVER_DEBOUNCE_MS);
  }, [cancelScheduledPrefetch, queryClient, steamAppId]);

  useEffect(() => () => cancelScheduledPrefetch(), [cancelScheduledPrefetch]);

  return {
    onHoverStart: schedulePrefetch,
    onHoverEnd: cancelScheduledPrefetch,
  };
}
