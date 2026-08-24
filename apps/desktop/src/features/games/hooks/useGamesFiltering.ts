import { useState } from "react";
import type { ConfiguredGame } from "@savecloud/types";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { filterGames, type OriginFilter } from "@features/games/GamesFilters";

export function useGamesFiltering(games: readonly ConfiguredGame[] = [], cloudGamesCount: number = 0) {
  const [searchTerm, setSearchTerm] = useState("");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");

  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const filteredGames = filterGames(games, debouncedSearchTerm, originFilter);
  const hasConfiguredGames = games.length > 0;
  const hasCloudGames = cloudGamesCount > 0;

  const emptyFilterMessage =
    hasConfiguredGames && (debouncedSearchTerm !== "" || originFilter !== "all")
      ? "No se encontraron juegos con los filtros aplicados."
      : !hasConfiguredGames && hasCloudGames
        ? "No hay juegos configurados, pero tienes guardados en la nube. Añade de nuevo cada juego con el mismo identificador y la ruta local para poder descargar sus backups."
        : undefined;

  return {
    searchTerm,
    setSearchTerm,
    originFilter,
    setOriginFilter,
    debouncedSearchTerm,
    filteredGames,
    emptyFilterMessage,
  };
}
