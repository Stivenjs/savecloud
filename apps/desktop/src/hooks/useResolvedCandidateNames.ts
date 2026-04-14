import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PathCandidate } from "@services/tauri";
import { getSteamAppNamesBatch } from "@services/tauri";
import { extractAppIdFromFolderName } from "@utils/gameImage";

const CANDIDATE_NAME_QUERY_KEY = ["candidate-names-batch"] as const;

/**
 * Resuelve los nombres de juegos para candidatos que tienen Steam App ID
 * (ej. "EMPRESS — 2050650" → "Resident Evil 4").
 */
export function useResolvedCandidateNames(
  candidates: PathCandidate[] | undefined
): Record<string, string | null | undefined> {
  const { toResolve, uniqueAppIds } = useMemo(() => {
    if (!candidates) return { toResolve: [], uniqueAppIds: [] };

    const validCandidates = candidates.filter((c) => c.steamAppId || extractAppIdFromFolderName(c.folderName ?? ""));

    const appIds = new Set<string>();
    validCandidates.forEach((c) => {
      const appId = c.steamAppId ?? extractAppIdFromFolderName(c.folderName ?? "");
      if (appId) appIds.add(appId);
    });

    return {
      toResolve: validCandidates,
      uniqueAppIds: Array.from(appIds),
    };
  }, [candidates]);

  const { data: namesMap, isFetched } = useQuery({
    queryKey: [...CANDIDATE_NAME_QUERY_KEY, uniqueAppIds.join(",")],
    queryFn: async () => {
      if (uniqueAppIds.length === 0) return {};
      return getSteamAppNamesBatch(uniqueAppIds);
    },
    enabled: uniqueAppIds.length > 0,
    staleTime: 1000 * 60 * 60,
    retry: 2,
  });

  return useMemo(() => {
    const result: Record<string, string | null | undefined> = {};

    toResolve.forEach((c) => {
      const appId = c.steamAppId ?? extractAppIdFromFolderName(c.folderName ?? "");
      if (appId) {
        result[c.path] = isFetched ? (namesMap?.[appId] ?? null) : undefined;
      } else {
        result[c.path] = null;
      }
    });

    return result;
  }, [toResolve, namesMap, isFetched]);
}
