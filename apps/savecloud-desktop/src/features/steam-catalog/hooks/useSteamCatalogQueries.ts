import { useCallback, useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CatalogListItem } from "@services/tauri";
import type { SourceMatchResult } from "@services/tauri";
import {
  getSteamAppdetailsMediaBatch,
  getSteamCatalogFilterFacets,
  listSteamCatalogPage,
  searchSteamCatalog,
  sourcesFindMatchesBatch,
  syncSteamStoreTrending,
} from "@services/tauri";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import {
  STEAM_CATALOG_PAGE_SIZE,
  STEAM_CATALOG_SEARCH_LIMIT,
  STEAM_CATALOG_SEARCH_MIN,
} from "@features/steam-catalog/constants";

function selectionKey(labels: string[]): string {
  return [...labels].sort().join("\u0001");
}

export function useSteamCatalogQueries() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  const debounced = useDebouncedValue(searchTerm.trim(), 350);
  const searchMode = debounced.length >= STEAM_CATALOG_SEARCH_MIN;

  const genresKey = useMemo(() => selectionKey(selectedGenres), [selectedGenres]);
  const tagsKey = useMemo(() => selectionKey(selectedTags), [selectedTags]);

  useEffect(() => {
    setPage(1);
  }, [searchMode, debounced, genresKey, tagsKey]);

  const facetsQuery = useQuery({
    queryKey: ["steamCatalog", "facets"],
    queryFn: getSteamCatalogFilterFacets,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    void (async () => {
      try {
        await syncSteamStoreTrending();
      } catch {
        /* Sin ranking de tienda; el listado sigue ordenando por app_id. */
      }
      await queryClient.invalidateQueries({ queryKey: ["steamCatalog"] });
    })();
  }, [queryClient]);

  const browseQuery = useQuery({
    queryKey: ["steamCatalog", "browse", page, genresKey, tagsKey],
    queryFn: () =>
      listSteamCatalogPage(
        (page - 1) * STEAM_CATALOG_PAGE_SIZE,
        STEAM_CATALOG_PAGE_SIZE,
        selectedGenres.length ? selectedGenres : null,
        selectedTags.length ? selectedTags : null
      ),
    enabled: !searchMode,
    placeholderData: keepPreviousData,
  });

  const searchQuery = useQuery({
    queryKey: ["steamCatalog", "search", debounced, genresKey, tagsKey],
    queryFn: () =>
      searchSteamCatalog(
        debounced,
        STEAM_CATALOG_SEARCH_LIMIT,
        selectedGenres.length ? selectedGenres : null,
        selectedTags.length ? selectedTags : null
      ),
    enabled: searchMode,
  });

  const searchResultsAll: CatalogListItem[] = searchQuery.data ?? [];

  const totalBrowse = browseQuery.data?.total ?? 0;
  const totalSearch = searchResultsAll.length;

  const totalPages = searchMode
    ? Math.max(1, Math.ceil(totalSearch / STEAM_CATALOG_PAGE_SIZE))
    : Math.max(1, Math.ceil(totalBrowse / STEAM_CATALOG_PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const items: CatalogListItem[] = useMemo(() => {
    if (searchMode) {
      const start = (page - 1) * STEAM_CATALOG_PAGE_SIZE;
      return searchResultsAll.slice(start, start + STEAM_CATALOG_PAGE_SIZE);
    }
    return browseQuery.data?.items ?? [];
  }, [searchMode, searchResultsAll, browseQuery.data?.items, page]);

  const steamAppIdsForBatch = useMemo(() => {
    const ids = items.map((i) => i.steamAppId).filter(Boolean);
    return [...new Set(ids)].sort();
  }, [items]);

  const mediaQuery = useQuery({
    queryKey: ["steam-appdetails-media-batch", steamAppIdsForBatch.join(",")],
    queryFn: () => getSteamAppdetailsMediaBatch(steamAppIdsForBatch),
    enabled: steamAppIdsForBatch.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  /** Hasta que el batch de portadas termine (1.ª vez por clave), las cards quedaban sin media y parecían rotas. */
  const isMediaBatchPending = steamAppIdsForBatch.length > 0 && !mediaQuery.isFetched;

  const visibleNames = useMemo(() => items.map((i) => i.name), [items]);
  const matchesQuery = useQuery({
    queryKey: ["sources-matches", visibleNames.join("|")],
    queryFn: () => sourcesFindMatchesBatch(visibleNames),
    enabled: visibleNames.length > 0,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
  });
  const matchByGameName = useMemo(() => {
    const map: Record<string, SourceMatchResult> = {};
    for (const entry of matchesQuery.data ?? []) {
      map[entry.gameName] = entry;
    }
    return map;
  }, [matchesQuery.data]);

  const isLoading = searchMode ? searchQuery.isPending : browseQuery.isPending;
  const isError = searchMode ? searchQuery.isError : browseQuery.isError;
  const errorMsg = (searchMode ? searchQuery.error : browseQuery.error) as Error | undefined;
  const isPageTransition = searchMode ? searchQuery.isFetching : browseQuery.isFetching;

  const toggleGenre = useCallback((label: string) => {
    setSelectedGenres((prev) => {
      const i = prev.indexOf(label);
      if (i >= 0) return prev.filter((_, j) => j !== i);
      return [...prev, label];
    });
  }, []);

  const toggleTag = useCallback((label: string) => {
    setSelectedTags((prev) => {
      const i = prev.indexOf(label);
      if (i >= 0) return prev.filter((_, j) => j !== i);
      return [...prev, label];
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedGenres([]);
    setSelectedTags([]);
  }, []);

  const filterSignature = `${genresKey}|${tagsKey}`;

  const rangeStart = items.length > 0 ? (page - 1) * STEAM_CATALOG_PAGE_SIZE + 1 : 0;
  const rangeEnd = searchMode
    ? Math.min(page * STEAM_CATALOG_PAGE_SIZE, totalSearch)
    : Math.min(page * STEAM_CATALOG_PAGE_SIZE, totalBrowse);
  const totalForRange = searchMode ? totalSearch : totalBrowse;

  return {
    searchTerm,
    setSearchTerm,
    debouncedSearch: debounced,
    searchMode,
    filterSignature,
    page,
    setPage,
    totalPages,
    rangeStart,
    rangeEnd,
    totalForRange,
    items,
    totalBrowse,
    mediaBySteamAppId: mediaQuery.data ?? null,
    matchByGameName,
    isMediaBatchPending,
    isMatchingPending: matchesQuery.isPending || matchesQuery.isFetching,
    isLoading,
    isError,
    errorMsg,
    isPageTransition,
    facets: facetsQuery.data ?? null,
    facetsLoading: facetsQuery.isPending,
    selectedGenres,
    selectedTags,
    toggleGenre,
    toggleTag,
    clearFilters,
  };
}
