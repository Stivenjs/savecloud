import { useQuery } from "@tanstack/react-query";
import { getSteamSeedFreshness } from "@services/tauri";

export const STEAM_SEED_FRESHNESS_QUERY_KEY = ["steamSeedFreshness"] as const;

export function useSteamSeedFreshness() {
  return useQuery({
    queryKey: STEAM_SEED_FRESHNESS_QUERY_KEY,
    queryFn: () => getSteamSeedFreshness(),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
