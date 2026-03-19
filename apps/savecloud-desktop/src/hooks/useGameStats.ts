import { useQuery } from "@tanstack/react-query";
import { getGameStats } from "@services/tauri";
import { useMemo } from "react";

const GAME_STATS_QUERY_KEY = ["game-stats"] as const;

export function useGameStats(enabled: boolean) {
  const query = useQuery({
    queryKey: GAME_STATS_QUERY_KEY,
    queryFn: getGameStats,
    enabled,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const statsByGameId = useMemo(() => {
    return new Map((query.data ?? []).map((s) => [s.gameId, s]));
  }, [query.data]);

  return {
    statsByGameId,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}
