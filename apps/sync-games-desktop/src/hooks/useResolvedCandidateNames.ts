import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import type { PathCandidate } from "@services/tauri";
import { getSteamAppName } from "@services/tauri";
import { extractAppIdFromFolderName } from "@utils/gameImage";

const CANDIDATE_NAME_QUERY_KEY = ["candidate-name"] as const;
/** Pequeño delay entre peticiones para evitar rate limiting de Steam */
const STAGGER_MS = 200;

/**
 * Resuelve los nombres de juegos para candidatos que tienen Steam App ID
 * (ej. "EMPRESS — 2050650" → "Resident Evil 4").
 */
export function useResolvedCandidateNames(
  candidates: PathCandidate[] | undefined
): Record<string, string | null | undefined> {
  const toResolve = useMemo(
    () =>
      (candidates ?? []).filter(
        (c) =>
          c.steamAppId ||
          extractAppIdFromFolderName(c.folderName ?? "")
      ),
    [candidates]
  );

  const queries = useQueries({
    queries: toResolve.map((c, index) => ({
      queryKey: [...CANDIDATE_NAME_QUERY_KEY, c.path],
      queryFn: async () => {
        // Escalonar peticiones para reducir rate limiting
        if (index > 0) {
          await new Promise((r) =>
            setTimeout(r, index * STAGGER_MS)
          );
        }
        const appId =
          c.steamAppId ?? extractAppIdFromFolderName(c.folderName ?? "");
        if (!appId) return null;
        return getSteamAppName(appId);
      },
      retry: 2,
      retryDelay: (attempt: number) => Math.min(1000 * 2 ** (attempt as number), 5000),
    })),
  });

  return useMemo(() => {
    const result: Record<string, string | null | undefined> = {};
    toResolve.forEach((c, i) => {
      const { data, isFetched } = queries[i] ?? {};
      result[c.path] = isFetched ? data ?? null : undefined;
    });
    return result;
  }, [toResolve, queries]);
}
