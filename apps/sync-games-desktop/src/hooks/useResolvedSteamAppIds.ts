import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ConfiguredGame } from "@app-types/config";
import { needsSteamSearch, idToSearchQuery } from "@utils/gameImage";
import { searchSteamAppIdsBatch } from "@services/tauri";

const STEAM_APP_ID_QUERY_KEY = ["steam-app-id", "batch"] as const;

/**
 * Hook que resuelve Steam App IDs para juegos que no tienen imagen (needsSteamSearch).
 * Usa una sola operación batch en el backend (varias búsquedas en paralelo).
 * TanStack Query cachea el resultado por la lista de juegos a buscar.
 */
export function useResolvedSteamAppIds(
  games: readonly ConfiguredGame[]
): Record<string, string | null | undefined> {
  const gamesToSearch = useMemo(
    () => games.filter((g) => needsSteamSearch(g)),
    [games]
  );

  const queryKey = useMemo(
    () => [...STEAM_APP_ID_QUERY_KEY, gamesToSearch.map((g) => g.id).sort().join(",")],
    [gamesToSearch]
  );

  const { data: batchResults, isFetched } = useQuery({
    queryKey,
    queryFn: async () => {
      const queries = gamesToSearch.map((g) => idToSearchQuery(g.id));
      return searchSteamAppIdsBatch(queries);
    },
    enabled: gamesToSearch.length > 0,
  });

  return useMemo(() => {
    const result: Record<string, string | null | undefined> = {};
    gamesToSearch.forEach((game, i) => {
      const appId = batchResults?.[i] ?? undefined;
      result[game.id] = isFetched ? (appId ?? null) : undefined;
    });
    return result;
  }, [gamesToSearch, batchResults, isFetched]);
}
