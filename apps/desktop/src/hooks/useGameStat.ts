import { useQuery } from "@tanstack/react-query";
import { getGameStat } from "@services/tauri/games.service";

export const GAME_STATS_QUERY_KEY = ["game-stats"] as const;

export function useGameStat(gameId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: [...GAME_STATS_QUERY_KEY, gameId],
    queryFn: () => getGameStat(gameId!),
    enabled: enabled && !!gameId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
