import { useMemo } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { CatalogListItem } from "@services/tauri";
import { listSteamCatalogPage, searchSteamCatalog } from "@services/tauri";
import type { CatalogSortOption } from "@features/steam-catalog/components/SteamCatalogToolbar";
import { STEAM_CATALOG_SEARCH_LIMIT } from "@/constants/constants";

function selectionKey(labels: string[]): string {
  return [...labels].sort().join("\u0001");
}

export type UseSteamCatalogInfiniteQueryOptions = {
  pageSize: number;
  selectedGenres: string[];
  selectedTags: string[];
  searchMode: boolean;
  debouncedSearch: string;
  sortOption: CatalogSortOption;
  trendingReady: boolean;
};

export function useSteamCatalogInfiniteQuery({
  pageSize,
  selectedGenres,
  selectedTags,
  searchMode,
  debouncedSearch,
  sortOption,
  trendingReady,
}: UseSteamCatalogInfiniteQueryOptions) {
  const genresKey = useMemo(() => selectionKey(selectedGenres), [selectedGenres]);
  const tagsKey = useMemo(() => selectionKey(selectedTags), [selectedTags]);

  const browseInfiniteQuery = useInfiniteQuery({
    queryKey: ["steamCatalog", "infiniteBrowse", genresKey, tagsKey, pageSize],
    queryFn: async ({ pageParam = 0 }) => {
      return listSteamCatalogPage(
        pageParam * pageSize,
        pageSize,
        selectedGenres.length ? selectedGenres : null,
        selectedTags.length ? selectedTags : null,
        null
      );
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.length * pageSize;
      if (loadedCount >= lastPage.total) {
        return undefined;
      }
      return allPages.length;
    },
    enabled: !searchMode && trendingReady,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const searchQuery = useQuery({
    queryKey: ["steamCatalog", "search", debouncedSearch, genresKey, tagsKey],
    queryFn: () =>
      searchSteamCatalog(
        debouncedSearch,
        STEAM_CATALOG_SEARCH_LIMIT,
        selectedGenres.length ? selectedGenres : null,
        selectedTags.length ? selectedTags : null
      ),
    enabled: searchMode && trendingReady,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const rawItems: CatalogListItem[] = useMemo(() => {
    const list = searchMode
      ? (searchQuery.data ?? [])
      : (browseInfiniteQuery.data?.pages.flatMap((p) => p.items) ?? []);

    const seen = new Set<string>();
    return list.filter((item) => {
      const id = item.steamAppId || item.name;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [searchMode, searchQuery.data, browseInfiniteQuery.data]);

  const sortedItems: CatalogListItem[] = useMemo(() => {
    if (sortOption === "trending") {
      return rawItems;
    }
    const copy = [...rawItems];
    if (sortOption === "title_asc") {
      return copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    }
    if (sortOption === "title_desc") {
      return copy.sort((a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: "base" }));
    }
    if (sortOption === "newest") {
      return copy.sort((a, b) => (Number(b.steamAppId) || 0) - (Number(a.steamAppId) || 0));
    }
    return rawItems;
  }, [rawItems, sortOption]);

  const totalBrowse = browseInfiniteQuery.data?.pages[0]?.total ?? 0;
  const totalSearch = (searchQuery.data ?? []).length;
  const totalCount = searchMode ? totalSearch : totalBrowse;

  return {
    items: sortedItems,
    totalCount,
    isLoading: searchMode ? searchQuery.isLoading : browseInfiniteQuery.isLoading,
    isFetchingNextPage: browseInfiniteQuery.isFetchingNextPage,
    hasNextPage: searchMode ? false : Boolean(browseInfiniteQuery.hasNextPage),
    fetchNextPage: browseInfiniteQuery.fetchNextPage,
  };
}
