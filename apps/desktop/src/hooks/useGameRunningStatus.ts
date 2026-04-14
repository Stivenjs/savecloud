import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { checkGamesRunning } from "@services/tauri";
import { CONFIG_QUERY_KEY } from "@hooks/useConfig";

const QUERY_KEY = ["game-running"] as const;
const GAME_STATS_QUERY_KEY = ["game-stats"] as const;

interface PlaytimePayload {
  gameId: string;
  newTime: number;
}

export function useGameRunningStatus(gameIds: readonly string[]): Record<string, boolean> {
  const queryClient = useQueryClient();

  const sortedIds = [...gameIds].sort();
  const idsKey = sortedIds.join(",");

  const { data } = useQuery({
    queryKey: [...QUERY_KEY, sortedIds],
    queryFn: () => checkGamesRunning(sortedIds),
    enabled: sortedIds.length > 0,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (sortedIds.length === 0) return;

    let unlisteners: UnlistenFn[] = [];

    async function setupListeners() {
      const unlistenStatus = await listen<Record<string, boolean>>("games-running-status", (event) => {
        const globalState = event.payload;

        queryClient.setQueryData([...QUERY_KEY, sortedIds], (oldData: any) => {
          if (!oldData) return globalState;
          return { ...oldData, ...globalState };
        });
      });

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

      unlisteners.push(unlistenTime);

      const unlistenTotal = await listen<number>("total-playtime-updated", (event) => {
        queryClient.setQueryData(CONFIG_QUERY_KEY, (oldConfig: any) => {
          if (!oldConfig) return oldConfig;

          return {
            ...oldConfig,
            totalPlaytime: event.payload,
          };
        });
      });

      unlisteners.push(unlistenTotal);
    }

    setupListeners();

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, [queryClient, idsKey]);

  const map = data ?? {};
  const result: Record<string, boolean> = {};

  gameIds.forEach((id) => {
    result[id] = map[id] === true;
  });

  return result;
}
