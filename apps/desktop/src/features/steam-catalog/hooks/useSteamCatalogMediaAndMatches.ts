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
      const CHUNK_SIZE = 50;

      const mediaChunks: string[][] = [];
      for (let i = 0; i < unmappedAppIds.length; i += CHUNK_SIZE) {
        mediaChunks.push(unmappedAppIds.slice(i, i + CHUNK_SIZE));
      }

      const namesChunks: string[][] = [];
      for (let i = 0; i < unmappedNames.length; i += CHUNK_SIZE) {
        namesChunks.push(unmappedNames.slice(i, i + CHUNK_SIZE));
      }

      const [mediaChunkResults, matchesChunkResults] = await Promise.all([
        Promise.all(
          mediaChunks.map(async (chunk) => {
            try {
              return await getSteamAppdetailsMediaBatch(chunk);
            } catch {
              return {};
            }
          })
        ),
        Promise.all(
          namesChunks.map(async (chunk) => {
            try {
              return await sourcesFindMatchesBatch(chunk);
            } catch {
              return [];
            }
          })
        ),
      ]);

      const mediaResults: Record<string, SteamAppdetailsMediaResult> = {};
      for (const res of mediaChunkResults) {
        if (res && Object.keys(res).length > 0) {
          Object.assign(mediaResults, res);
        }
      }

      const matchesResults: Record<string, SourceBestMatch[]> = {};
      for (const raw of matchesChunkResults) {
        if (raw && Array.isArray(raw) && raw.length > 0) {
          Object.assign(matchesResults, mapBatchMatchesToRecord(raw));
        }
      }

      let updatedMedia = { ...cachedMedia, ...mediaResults };
      let updatedMatches = { ...cachedMatches, ...matchesResults };

      for (const id of unmappedAppIds) {
        if (!updatedMedia[id]) {
          updatedMedia[id] = { name: "", genres: [], mediaUrls: [], videoUrl: null, capsuleImage: null };
        }
      }
      queryClient.setQueryData(MEDIA_CACHE_KEY, updatedMedia);

      for (const name of unmappedNames) {
        if (!(name in updatedMatches)) {
          updatedMatches[name] = [];
        }
      }
      queryClient.setQueryData(MATCHES_CACHE_KEY, updatedMatches);

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
