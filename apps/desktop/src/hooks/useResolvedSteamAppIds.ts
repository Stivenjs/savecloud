import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConfiguredGame } from "@app-types/config";
import { needsSteamSearch, idToSearchQuery } from "@utils/gameImage";
import { searchSteamAppIdsBatch } from "@services/tauri";

/**
 * Hook que resuelve Steam App IDs para juegos que no tienen imagen (needsSteamSearch).
 * Utiliza normalización a nivel de entidad en React Query (["steam-app-id", game.id])
 * para evitar re-descargar o invalidar toda la biblioteca cuando se añade o modifica un juego.
 * Solo consulta al backend el delta de juegos que no estén ya en la caché de React Query.
 */
export function useResolvedSteamAppIds(games: readonly ConfiguredGame[]): Record<string, string | null | undefined> {
  const queryClient = useQueryClient();
  const gamesToSearch = useMemo(() => games.filter((g) => needsSteamSearch(g)), [games]);

  /** Filtrar únicamente los juegos que aún no residen en la caché de React Query */
  const missingGames = useMemo(() => {
    return gamesToSearch.filter((game) => queryClient.getQueryData(["steam-app-id", game.id]) === undefined);
  }, [gamesToSearch, queryClient]);

  const missingIdsKey = useMemo(
    () =>
      missingGames
        .map((g) => g.id)
        .sort()
        .join(","),
    [missingGames]
  );

  const { data: newlyFetchedDelta } = useQuery({
    queryKey: ["steam-app-id-batch-delta", missingIdsKey],
    queryFn: async () => {
      if (missingGames.length === 0) return {};
      const queries = missingGames.map((g) => idToSearchQuery(g.id));
      const batchResults = await searchSteamAppIdsBatch(queries);

      const deltaMap: Record<string, string | null> = {};
      missingGames.forEach((game, i) => {
        const resolved = batchResults?.[i] ?? null;
        deltaMap[game.id] = resolved;
        queryClient.setQueryData(["steam-app-id", game.id], resolved);
      });

      return deltaMap;
    },
    enabled: missingGames.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return useMemo(() => {
    const result: Record<string, string | null | undefined> = {};

    for (const game of gamesToSearch) {
      const cached = queryClient.getQueryData<string | null>(["steam-app-id", game.id]);
      if (cached !== undefined) {
        result[game.id] = cached;
      } else if (newlyFetchedDelta && game.id in newlyFetchedDelta) {
        result[game.id] = newlyFetchedDelta[game.id];
      } else {
        result[game.id] = undefined;
      }
    }

    return result;
  }, [gamesToSearch, newlyFetchedDelta, queryClient]);
}
