import { useQuery } from "@tanstack/react-query";
import { getGamificationState } from "@services/tauri";

export const GAMIFICATION_QUERY_KEY = ["gamification"] as const;

/** Hook para obtener el estado de la gamificación */
export function useGamification() {
  return useQuery({
    queryKey: GAMIFICATION_QUERY_KEY,
    queryFn: getGamificationState,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
