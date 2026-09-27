import { queryOptions } from "@tanstack/react-query";
import { syncCheckUnsyncedGames } from "@services/tauri";

export const UNSYNCED_GAMES_QUERY_KEY = ["unsynced-games"] as const;

export function unsyncedGamesQueryOptions() {
  return queryOptions({
    queryKey: UNSYNCED_GAMES_QUERY_KEY,
    queryFn: syncCheckUnsyncedGames,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
