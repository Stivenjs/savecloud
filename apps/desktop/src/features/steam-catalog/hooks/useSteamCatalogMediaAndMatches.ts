import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CatalogListItem, SteamAppdetailsMediaResult, SourceBestMatch } from "@services/tauri";
import { getSteamAppdetailsMediaBatch, sourcesFindMatchesBatch } from "@services/tauri";
import { mapBatchMatchesToRecord } from "@utils/sourceMatch";

export function useSteamCatalogMediaAndMatches(items: CatalogListItem[], pageSize: number) {
  const mediaCacheRef = useRef<Record<string, SteamAppdetailsMediaResult>>({});
  const matchesCacheRef = useRef<Record<string, SourceBestMatch[]>>({});

  const unmappedAppIds = useMemo(() => {
    const ids = items.map((i) => i.steamAppId).filter((id): id is string => Boolean(id && !mediaCacheRef.current[id]));
    return [...new Set(ids)].sort();
  }, [items]);

  const unmappedAppIdsKey = useMemo(() => unmappedAppIds.join(","), [unmappedAppIds]);

  const unmappedNames = useMemo(() => {
    const names = items.map((i) => i.name).filter((name) => Boolean(name && !(name in matchesCacheRef.current)));
    return [...new Set(names)].sort();
  }, [items]);

  const unmappedNamesKey = useMemo(() => unmappedNames.join("|"), [unmappedNames]);

  const batchQueryKey = `${unmappedAppIdsKey}||${unmappedNamesKey}`;

  const batchQuery = useQuery({
    queryKey: ["steam-catalog-media-matches-batch", batchQueryKey],
    queryFn: async () => {
      const [mediaRes, matchesRaw] = await Promise.all([
        unmappedAppIds.length > 0 ? getSteamAppdetailsMediaBatch(unmappedAppIds) : Promise.resolve({}),
        unmappedNames.length > 0 ? sourcesFindMatchesBatch(unmappedNames) : Promise.resolve([]),
      ]);

      if (mediaRes && Object.keys(mediaRes).length > 0) {
        Object.assign(mediaCacheRef.current, mediaRes);
      }
      if (matchesRaw && Array.isArray(matchesRaw) && matchesRaw.length > 0) {
        const mapped = mapBatchMatchesToRecord(matchesRaw);
        Object.assign(matchesCacheRef.current, mapped);
      }

      return {
        media: mediaCacheRef.current,
        matches: matchesCacheRef.current,
      };
    },
    enabled: unmappedAppIds.length > 0 || unmappedNames.length > 0,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const mediaBySteamAppId = useMemo(() => {
    return { ...mediaCacheRef.current };
  }, [batchQuery.data, items]);

  const matchByGameName = useMemo(() => {
    return { ...matchesCacheRef.current };
  }, [batchQuery.data, items]);

  const isMediaBatchPending = unmappedAppIds.length > 0 && batchQuery.isPending && items.length <= pageSize;
  const isMatchingPending = unmappedNames.length > 0 && batchQuery.isPending;

  return {
    mediaBySteamAppId,
    isMediaBatchPending,
    matchByGameName,
    isMatchingPending,
  };
}
