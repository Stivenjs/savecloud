import { useMemo, useState } from "react";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { useGameMediaBatch, getIsResolvingIds } from "@hooks/useGameMedia";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";

/** Tiempo de espera en ms antes de aplicar el filtro de búsqueda. */
const SEARCH_DEBOUNCE_MS = 220;

/**
 * Opciones para {@link useMenuGamesList}.
 */
interface UseMenuGamesListOptions {
  /** Lista completa de juegos configurados en la aplicación. */
  games: readonly ConfiguredGame[];
}

/**
 * Valor devuelto por {@link useMenuGamesList}.
 */
export interface UseMenuGamesListResult {
  /** Texto de búsqueda sin debounce (para el valor del input). */
  searchValue: string;
  /** Setter del texto de búsqueda. */
  setSearchValue: (v: string) => void;
  /** Lista de juegos que pasan el filtro de búsqueda. */
  filteredGames: readonly ConfiguredGame[];
  /**
   * Mapa `steamAppId → media` disponible para todos los juegos visibles.
   * `null` mientras el batch aún no ha respondido.
   */
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  /**
   * Mapa `gameId → steamAppId` resuelto (incluyendo búsquedas fuzzy).
   * Necesario para derivar la imagen correcta en cada `GameCard`.
   */
  resolvedSteamAppIds: Record<string, string | null | undefined>;
  /** `true` si la query batch todavía está en vuelo. */
  isBatchLoading: boolean;
}

/**
 * Gestiona el estado de búsqueda y los datos de media para la lista de juegos
 * del panel lateral del menú.
 *
 * Responsabilidades:
 * - Mantiene el valor del input de búsqueda y lo desacelera con {@link useDebouncedValue}.
 * - Filtra la lista de juegos por el término debounced (insensible a mayúsculas).
 * - Resuelve los Steam App IDs y carga la media en batch para los juegos filtrados.
 *
 * @example
 * ```tsx
 * const {
 *   searchValue, setSearchValue,
 *   filteredGames, mediaBySteamAppId, resolvedSteamAppIds,
 * } = useMenuGamesList({ games });
 * ```
 */
export function useMenuGamesList({ games }: UseMenuGamesListOptions): UseMenuGamesListResult {
  const [searchValue, setSearchValue] = useState("");
  const debouncedSearch = useDebouncedValue(searchValue, SEARCH_DEBOUNCE_MS);

  const filteredGames = useMemo<readonly ConfiguredGame[]>(() => {
    const term = debouncedSearch.trim().toLowerCase();
    if (!term) return games;
    return games.filter((g) => formatGameDisplayName(g.id).toLowerCase().includes(term));
  }, [games, debouncedSearch]);

  const resolvedSteamAppIds = useResolvedSteamAppIds(filteredGames);

  const isResolvingIds = useMemo(
    () => getIsResolvingIds(filteredGames, resolvedSteamAppIds),
    [filteredGames, resolvedSteamAppIds]
  );

  const { mediaBySteamAppId } = useGameMediaBatch({
    games: filteredGames,
    resolvedSteamAppIds,
    isResolvingIds,
  });

  const isBatchLoading = mediaBySteamAppId === null && filteredGames.length > 0 && !isResolvingIds;

  return {
    searchValue,
    setSearchValue,
    filteredGames,
    mediaBySteamAppId,
    resolvedSteamAppIds,
    isBatchLoading,
  };
}
