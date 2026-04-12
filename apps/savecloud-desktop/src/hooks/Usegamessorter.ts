/**
 * useGamesSorter
 * Ordena una lista de ConfiguredGame según el campo y dirección elegidos.
 * Requiere GameStats para ordenar por lastModified, playtime y size.
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
    const sorted = [...games].sort((a, b) => {
      let cmp = 0;

      switch (sortBy) {
        case "title": {
          const nameA = formatGameDisplayName(a.id).toLowerCase();
          const nameB = formatGameDisplayName(b.id).toLowerCase();
          cmp = nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
          break;
        }
        case "lastModified": {
          const statsA = statsByGameId.get(a.id);
          const statsB = statsByGameId.get(b.id);
          const tsA = statsA?.localLastModified ? new Date(statsA.localLastModified).getTime() : 0;
          const tsB = statsB?.localLastModified ? new Date(statsB.localLastModified).getTime() : 0;
          cmp = tsA - tsB;
          break;
        }
        case "playtime": {
          const statsA = statsByGameId.get(a.id);
          const statsB = statsByGameId.get(b.id);
          cmp = (statsA?.playtimeSeconds ?? 0) - (statsB?.playtimeSeconds ?? 0);
          break;
        }
        case "size": {
          const statsA = statsByGameId.get(a.id);
          const statsB = statsByGameId.get(b.id);
          cmp = (statsA?.localSizeBytes ?? 0) - (statsB?.localSizeBytes ?? 0);
          break;
        }
      }

      return sortDir === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [games, statsByGameId, sortBy, sortDir]);
}
