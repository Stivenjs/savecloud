import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { checkGamesRunning } from "@services/tauri";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";

/**
 * Key estático para el mapa global de juegos en ejecución.
 * Usar un key fijo (sin el array de IDs dentro) garantiza que el listener
 * de eventos siempre actualiza el mismo entry del cache que useQuery lee,
 * independientemente de qué instancia del hook registró el listener.
 */
export const RUNNING_STATUS_KEY = ["game-running-status"] as const;
const GAME_STATS_QUERY_KEY = ["game-stats"] as const;

interface PlaytimePayload {
  gameId: string;
  newTime: number;
}

export function useGameRunningStatus(gameIds: readonly string[]): Record<string, boolean> {
  const queryClient = useQueryClient();

  const sortedIds = useMemo(() => [...gameIds].sort(), [gameIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useQuery({
    queryKey: [...RUNNING_STATUS_KEY, sortedIds.join(",")],
    queryFn: async () => {
      const fresh = await checkGamesRunning(sortedIds);
      queryClient.setQueryData(RUNNING_STATUS_KEY, (old: Record<string, boolean> | undefined) => ({
        ...(old ?? {}),
        ...fresh,
      }));
      return fresh;
    },
    enabled: sortedIds.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: globalMap } = useQuery<Record<string, boolean>>({
    queryKey: [...RUNNING_STATUS_KEY],
    queryFn: () => ({}),
    staleTime: Infinity,
  });

  useEffect(() => {
    let unlisteners: UnlistenFn[] = [];
    let cancelled = false;

    async function setupListeners() {
      const unlistenStatus = await listen<Record<string, boolean>>("games-running-status", (event) => {
        queryClient.setQueryData(RUNNING_STATUS_KEY, (old: Record<string, boolean> | undefined) => ({
          ...(old ?? {}),
          ...event.payload,
        }));
      });

      if (cancelled) {
        unlistenStatus();
        return;
      }
      unlisteners.push(unlistenStatus);

      const unlistenTime = await listen<PlaytimePayload>("playtime-updated", (event) => {
        const { gameId, newTime } = event.payload;

        queryClient.setQueryData(CONFIG_QUERY_KEY, (oldConfig: any) => {
          if (!oldConfig) return oldConfig;
          return {
            ...oldConfig,
            games: oldConfig.games.map((g: any) => (g.id === gameId ? { ...g, playtimeSeconds: newTime } : g)),
          };
        });

        queryClient.setQueryData(GAME_STATS_QUERY_KEY, (oldStats: any[] | undefined) => {
          if (!oldStats) return oldStats;
          return oldStats.map((s) => (s.gameId === gameId ? { ...s, playtimeSeconds: newTime } : s));
        });
      });

      if (cancelled) {
        unlistenTime();
        return;
      }
      unlisteners.push(unlistenTime);

      const unlistenTotal = await listen<number>("total-playtime-updated", (event) => {
        queryClient.setQueryData(CONFIG_QUERY_KEY, (oldConfig: any) => {
          if (!oldConfig) return oldConfig;
          return { ...oldConfig, totalPlaytime: event.payload };
        });
      });

      if (cancelled) {
        unlistenTotal();
        return;
      }
      unlisteners.push(unlistenTotal);
    }

    setupListeners();

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }, [queryClient]);

  return useMemo(() => {
    const map = globalMap ?? {};
    const result: Record<string, boolean> = {};
    gameIds.forEach((id) => {
      result[id] = map[id] === true;
    });
    return result;
  }, [globalMap, gameIds]);
}
