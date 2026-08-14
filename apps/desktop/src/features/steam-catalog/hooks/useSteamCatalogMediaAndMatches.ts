import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CatalogListItem, SteamAppdetailsMediaResult, SourceBestMatch } from "@services/tauri";
import { getSteamAppdetailsMediaBatch, sourcesFindMatchesBatch } from "@services/tauri";
import { mapBatchMatchesToRecord } from "@utils/sourceMatch";

const MEDIA_CACHE_KEY = ["steam-catalog-global-media-cache"];
const MATCHES_CACHE_KEY = ["steam-catalog-global-matches-cache"];

const EMPTY_MEDIA_OBJECT: Record<string, SteamAppdetailsMediaResult> = {};
const EMPTY_MATCHES_OBJECT: Record<string, SourceBestMatch[]> = {};

export function useSteamCatalogMediaAndMatches(items: CatalogListItem[], pageSize: number) {
  const queryClient = useQueryClient();

  const cachedMedia =
    queryClient.getQueryData<Record<string, SteamAppdetailsMediaResult>>(MEDIA_CACHE_KEY) ?? EMPTY_MEDIA_OBJECT;
  const cachedMatches =
    queryClient.getQueryData<Record<string, SourceBestMatch[]>>(MATCHES_CACHE_KEY) ?? EMPTY_MATCHES_OBJECT;

  const unmappedAppIds = useMemo(() => {
    const ids = items.map((i) => i.steamAppId).filter((id): id is string => Boolean(id && !cachedMedia[id]));
    return [...new Set(ids)].sort();
  }, [items, cachedMedia]);

  const unmappedAppIdsKey = useMemo(() => unmappedAppIds.join(","), [unmappedAppIds]);

  const unmappedNames = useMemo(() => {
    const names = items.map((i) => i.name).filter((name) => Boolean(name && !(name in cachedMatches)));
    return [...new Set(names)].sort();
  }, [items, cachedMatches]);

  const unmappedNamesKey = useMemo(() => unmappedNames.join("|"), [unmappedNames]);

  const batchQueryKey = ["steam-catalog-media-matches-fetch", unmappedAppIdsKey, unmappedNamesKey];

  const batchQuery = useQuery({
    queryKey: batchQueryKey,
    queryFn: async () => {
      const [mediaRes, matchesRaw] = await Promise.all([
        unmappedAppIds.length > 0 ? getSteamAppdetailsMediaBatch(unmappedAppIds) : Promise.resolve({}),
        unmappedNames.length > 0 ? sourcesFindMatchesBatch(unmappedNames) : Promise.resolve([]),
      ]);

      let updatedMedia = cachedMedia;
      let updatedMatches = cachedMatches;

      if (mediaRes && Object.keys(mediaRes).length > 0) {
        updatedMedia = { ...cachedMedia, ...mediaRes };
        queryClient.setQueryData(MEDIA_CACHE_KEY, updatedMedia);
      }
      if (matchesRaw && Array.isArray(matchesRaw) && matchesRaw.length > 0) {
        const mapped = mapBatchMatchesToRecord(matchesRaw);
        updatedMatches = { ...cachedMatches, ...mapped };
        queryClient.setQueryData(MATCHES_CACHE_KEY, updatedMatches);
      }

      return {
        media: updatedMedia,
        matches: updatedMatches,
      };
    },
    enabled: unmappedAppIds.length > 0 || unmappedNames.length > 0,
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const mediaBySteamAppId = batchQuery.data?.media ?? cachedMedia;
  const matchByGameName = batchQuery.data?.matches ?? cachedMatches;

  const isMediaBatchPending = unmappedAppIds.length > 0 && batchQuery.isPending && items.length <= pageSize;
  const isMatchingPending = unmappedNames.length > 0 && batchQuery.isPending;

  return {
    mediaBySteamAppId,
    isMediaBatchPending,
    matchByGameName,
    isMatchingPending,
  };
}
