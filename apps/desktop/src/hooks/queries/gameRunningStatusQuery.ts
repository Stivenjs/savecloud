import { checkGamesRunning } from "@services/tauri";

/** Clave compartida para el estado de ejecución de la biblioteca. */
export const RUNNING_STATUS_KEY = ["game-running-status"] as const;

export function gameRunningStatusQueryOptions(gameIds: readonly string[]) {
  const sortedIds = [...gameIds].sort();

  return {
    queryKey: [...RUNNING_STATUS_KEY, sortedIds.join(",")] as const,
    queryFn: () => checkGamesRunning(sortedIds),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  };
}
