import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { checkGamesRunning } from "@services/tauri";
import { LIBRARY_QUERY_KEY } from "@hooks/useLibrary";
import { GAME_STATS_QUERY_KEY } from "@hooks/useGameStat";
import { gameRunningStatusQueryOptions, RUNNING_STATUS_KEY } from "@hooks/queries/gameRunningStatusQuery";
import { useGameSessionStore } from "@store/GameSessionStore";

export { RUNNING_STATUS_KEY };

interface PlaytimePayload {
  gameId: string;
  newTime: number;
}

export function useGameRunningStatus(gameIds: readonly string[]): Record<string, boolean> {
  const queryClient = useQueryClient();

  const sortedIds = useMemo(() => [...gameIds].sort(), [gameIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useQuery({
    ...gameRunningStatusQueryOptions(sortedIds),
    queryFn: async () => {
      const fresh = await checkGamesRunning(sortedIds);
      useGameSessionStore.getState().syncLocalRunningMap(fresh);
      queryClient.setQueryData(RUNNING_STATUS_KEY, (old: Record<string, boolean> | undefined) => ({
        ...(old ?? {}),
        ...fresh,
      }));
      return fresh;
    },
    enabled: sortedIds.length > 0,
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
        useGameSessionStore.getState().syncLocalRunningMap(event.payload);
        queryClient.setQueryData(RUNNING_STATUS_KEY, (old: Record<string, boolean> | undefined) => ({
          ...(old ?? {}),
          ...event.payload,
        }));
        void queryClient.invalidateQueries({ queryKey: LIBRARY_QUERY_KEY });
      });

      if (cancelled) {
        unlistenStatus();
        return;
      }
      unlisteners.push(unlistenStatus);

      const unlistenTime = await listen<PlaytimePayload>("playtime-updated", (event) => {
        const { gameId, newTime } = event.payload;

        queryClient.setQueryData(LIBRARY_QUERY_KEY, (oldGames: any[] | undefined) =>
          oldGames?.map((game) => (game.id === gameId ? { ...game, playtimeSeconds: newTime } : game))
        );

        queryClient.setQueryData(GAME_STATS_QUERY_KEY, (oldStats: any[] | undefined) => {
          if (!oldStats) return oldStats;
          return oldStats.map((s) => (s.gameId === gameId ? { ...s, playtimeSeconds: newTime } : s));
        });

        queryClient.setQueryData([...GAME_STATS_QUERY_KEY, gameId], (oldStats: any | null | undefined) =>
          oldStats ? { ...oldStats, playtimeSeconds: newTime } : oldStats
        );
      });

      if (cancelled) {
        unlistenTime();
        return;
      }
      unlisteners.push(unlistenTime);

      const unlistenTotal = await listen<number>("total-playtime-updated", (event) => {
        queryClient.setQueryData(["config"], (oldConfig: any) =>
          oldConfig ? { ...oldConfig, totalPlaytime: event.payload } : oldConfig
        );
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

  const gameIdsKey = gameIds.join(",");
  return useMemo(() => {
    const map = globalMap ?? {};
    const result: Record<string, boolean> = {};
    gameIds.forEach((id) => {
      result[id] = map[id] === true;
    });
    return result;
  }, [globalMap, gameIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
