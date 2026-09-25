import { useQuery } from "@tanstack/react-query";
import { getGameSaveGraph } from "@services/tauri";

/**
 * Carga el grafo por juego directamente desde el backend Tauri.
 */
export function useGameSaveGraphData(gameId: string) {
  return useQuery({
    queryKey: ["save-graph", "game", gameId],
    queryFn: () => getGameSaveGraph(gameId),
    enabled: gameId.trim().length > 0,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
