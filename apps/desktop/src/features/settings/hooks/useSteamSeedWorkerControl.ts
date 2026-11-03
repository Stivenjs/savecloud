import { useQuery } from "@tanstack/react-query";
import { getSteamSeedWorkerControl } from "@services/tauri";

export const STEAM_SEED_WORKER_CONTROL_QUERY_KEY = ["steam-seed-worker-control"] as const;

/**
 * Obtiene el control del worker remoto.
 *
 * Un valor `null` significa que la sesión puede consultar el catálogo, pero no
 * administrarlo porque pertenece como invitado a la nube de otro usuario.
 */
export function useSteamSeedWorkerControl() {
  return useQuery({
    queryKey: STEAM_SEED_WORKER_CONTROL_QUERY_KEY,
    queryFn: getSteamSeedWorkerControl,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
