/**
 * useGamesSorter
 * Ordena una lista de ConfiguredGame según el campo y dirección elegidos.
 * Usa los metadatos locales disponibles y estadísticas bajo demanda para campos costosos.
 */

import { useMemo } from "react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { formatGameDisplayName } from "@utils/gameImage";
import type { GamesSortDir, GamesSortField } from "@hooks/useGamesViewPreferences";

export function useGamesSorter(
  games: readonly ConfiguredGame[],
  statsByGameId: Map<string, GameStats>,
  sortBy: GamesSortField,
  sortDir: GamesSortDir
): ConfiguredGame[] {
  return useMemo(() => {
    if (games.length <= 1) return [...games];

    if (sortBy === "title") {
      const titles = new Map<string, string>();
      for (const g of games) {
        titles.set(g.id, formatGameDisplayName(g.id).toLowerCase());
      }
      return [...games].sort((a, b) => {
        const nameA = titles.get(a.id) ?? "";
        const nameB = titles.get(b.id) ?? "";
        const cmp = nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    if (sortBy === "lastModified") {
      const timestamps = new Map<string, number>();
      for (const g of games) {
        const stats = statsByGameId.get(g.id);
        const ts = stats?.localLastModified ? Date.parse(stats.localLastModified) || 0 : 0;
        timestamps.set(g.id, ts);
      }
      return [...games].sort((a, b) => {
        const tsA = timestamps.get(a.id) ?? 0;
        const tsB = timestamps.get(b.id) ?? 0;
        const cmp = tsA - tsB;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    if (sortBy === "playtime") {
      return [...games].sort((a, b) => {
        const ptA = a.playtimeSeconds ?? 0;
        const ptB = b.playtimeSeconds ?? 0;
        const cmp = ptA - ptB;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    if (sortBy === "size") {
      return [...games].sort((a, b) => {
        const sizeA = statsByGameId.get(a.id)?.localSizeBytes ?? 0;
        const sizeB = statsByGameId.get(b.id)?.localSizeBytes ?? 0;
        const cmp = sizeA - sizeB;
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    return [...games];
  }, [games, statsByGameId, sortBy, sortDir]);
}
