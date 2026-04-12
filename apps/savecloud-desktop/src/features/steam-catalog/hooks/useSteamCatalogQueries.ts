import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CatalogListItem } from "@services/tauri";
import { mapBatchMatchesToRecord } from "@utils/sourceMatch";
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
  STEAM_CATALOG_URL_GENRE,
  STEAM_CATALOG_URL_PAGE,
  STEAM_CATALOG_URL_Q,
  STEAM_CATALOG_URL_TAG,
} from "@/constants/constants";

function selectionKey(labels: string[]): string {
  return [...labels].sort().join("\u0001");
}

function setRepeatedParam(params: URLSearchParams, key: string, values: string[]) {
  params.delete(key);
  for (const v of values) {
    params.append(key, v);
  }
}

/** No llamar a Steam en cada montaje; deduplica llamadas concurrentes (p. ej. React Strict Mode). */
const STEAM_TRENDING_SYNC_THROTTLE_MS = 30 * 60 * 1000;
const STORAGE_KEY_TRENDING_LAST = "steamCatalogTrendingLastSyncMs";

let trendingSyncInFlight: Promise<void> | null = null;

function syncSteamTrendingIfStale(): Promise<void> {
  if (trendingSyncInFlight) return trendingSyncInFlight;

  trendingSyncInFlight = (async () => {
    try {
      const now = Date.now();
      const raw = sessionStorage.getItem(STORAGE_KEY_TRENDING_LAST);
      const last = raw ? Number(raw) : 0;
      if (Number.isFinite(last) && now - last < STEAM_TRENDING_SYNC_THROTTLE_MS) {
        return;
      }
      await syncSteamStoreTrending();
      sessionStorage.setItem(STORAGE_KEY_TRENDING_LAST, String(Date.now()));
    } catch {
      /* Sin ranking de tienda; el listado sigue ordenando por app_id. */
    } finally {
      trendingSyncInFlight = null;
    }
  })();

  return trendingSyncInFlight;
}

/** Si la sync de tendencia fue reciente, el listado puede habilitarse sin esperar al efecto (evita spinner al volver al catálogo). */
function readTrendingReadyFromSession(): boolean {
  if (typeof sessionStorage === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY_TRENDING_LAST);
    const last = raw ? Number(raw) : 0;
    const now = Date.now();
    return Number.isFinite(last) && now - last < STEAM_TRENDING_SYNC_THROTTLE_MS;
  } catch {
    return false;
  }
}

export function useSteamCatalogQueries() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const skipSearchInputSyncFromDebouncedUrl = useRef(false);

  const page = useMemo(() => {
    const raw = searchParams.get(STEAM_CATALOG_URL_PAGE);
    const n = raw ? parseInt(raw, 10) : 1;
    return Number.isFinite(n) && n >= 1 ? n : 1;
  }, [searchParams]);

  const selectedGenres = useMemo(() => [...searchParams.getAll(STEAM_CATALOG_URL_GENRE)].sort(), [searchParams]);
  const selectedTags = useMemo(() => [...searchParams.getAll(STEAM_CATALOG_URL_TAG)].sort(), [searchParams]);

  const [searchInput, setSearchInput] = useState(() => searchParams.get(STEAM_CATALOG_URL_Q) ?? "");
  /** Listado/búsqueda esperan a la sync de tendencia (o al throttle) para no duplicar peticiones. */
  const [trendingReady, setTrendingReady] = useState(readTrendingReadyFromSession);

  const debounced = useDebouncedValue(searchInput.trim(), 350);
  const searchMode = debounced.length >= STEAM_CATALOG_SEARCH_MIN;

  const genresKey = useMemo(() => selectionKey(selectedGenres), [selectedGenres]);
  const tagsKey = useMemo(() => selectionKey(selectedTags), [selectedTags]);

  useEffect(() => {
    if (skipSearchInputSyncFromDebouncedUrl.current) {
      skipSearchInputSyncFromDebouncedUrl.current = false;
      return;
    }
    setSearchInput(searchParams.get(STEAM_CATALOG_URL_Q) ?? "");
  }, [searchParams]);

  useEffect(() => {
    setSearchParams(
      (prev) => {
        const currentQ = prev.get(STEAM_CATALOG_URL_Q) ?? "";
        if (debounced === currentQ) return prev;
        skipSearchInputSyncFromDebouncedUrl.current = true;
        const next = new URLSearchParams(prev);
        if (debounced) {
          next.set(STEAM_CATALOG_URL_Q, debounced);
        } else {
          next.delete(STEAM_CATALOG_URL_Q);
        }
        next.set(STEAM_CATALOG_URL_PAGE, "1");
        return next;
      },
      { replace: true }
    );
  }, [debounced, setSearchParams]);

  const facetsQuery = useQuery({
    queryKey: ["steamCatalog", "facets"],
    queryFn: getSteamCatalogFilterFacets,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await syncSteamTrendingIfStale();
      if (!cancelled) setTrendingReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const browseQuery = useQuery({
    queryKey: ["steamCatalog", "browse", page, genresKey, tagsKey],
    queryFn: () =>
      listSteamCatalogPage(
        (page - 1) * STEAM_CATALOG_PAGE_SIZE,
        STEAM_CATALOG_PAGE_SIZE,
        selectedGenres.length ? selectedGenres : null,
        selectedTags.length ? selectedTags : null
      ),
    enabled: !searchMode && trendingReady,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
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
    enabled: searchMode && trendingReady,
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const searchResultsAll: CatalogListItem[] = searchQuery.data ?? [];

  const totalBrowse = browseQuery.data?.total ?? 0;
  const totalSearch = searchResultsAll.length;

  const totalPages = searchMode
    ? Math.max(1, Math.ceil(totalSearch / STEAM_CATALOG_PAGE_SIZE))
    : Math.max(1, Math.ceil(totalBrowse / STEAM_CATALOG_PAGE_SIZE));

  useEffect(() => {
    if (page > totalPages) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(STEAM_CATALOG_URL_PAGE, String(totalPages));
          return next;
        },
        { replace: true }
      );
    }
  }, [page, totalPages, setSearchParams]);

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
  const visibleNamesKey = useMemo(() => {
    return [...visibleNames].sort().join("|");
  }, [visibleNames]);

  const matchesQuery = useQuery({
    queryKey: ["sources-matches", visibleNamesKey],
    queryFn: () => sourcesFindMatchesBatch(visibleNames),
    enabled: visibleNames.length > 0,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  });
  const matchByGameName = useMemo(() => {
    return mapBatchMatchesToRecord(matchesQuery.data);
  }, [matchesQuery.data]);

  const listQueryPendingNoData = searchMode
    ? searchQuery.isPending && searchQuery.data === undefined
    : browseQuery.isPending && browseQuery.data === undefined;

  const browseQueryKey = useMemo(
    () => ["steamCatalog", "browse", page, genresKey, tagsKey] as const,
    [page, genresKey, tagsKey]
  );
  const searchQueryKey = useMemo(
    () => ["steamCatalog", "search", debounced, genresKey, tagsKey] as const,
    [debounced, genresKey, tagsKey]
  );
  const hasListInCache = queryClient.getQueryData(searchMode ? searchQueryKey : browseQueryKey) !== undefined;

  /** No bloquear con «Cargando catálogo» si TanStack ya tiene datos en caché (p. ej. al volver del detalle sin red). */
  const isLoading = (!hasListInCache && !trendingReady) || (listQueryPendingNoData && trendingReady);
  const isError = searchMode ? searchQuery.isError : browseQuery.isError;
  const errorMsg = (searchMode ? searchQuery.error : browseQuery.error) as Error | undefined;
  const isPageTransition = searchMode ? searchQuery.isFetching : browseQuery.isFetching;
  const isListRefetching =
    trendingReady && !listQueryPendingNoData && (searchMode ? searchQuery.isFetching : browseQuery.isFetching);

  const setPage = useCallback(
    (next: number | ((prev: number) => number)) => {
      setSearchParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          const current = Math.max(1, parseInt(prev.get(STEAM_CATALOG_URL_PAGE) ?? "1", 10) || 1);
          const resolved = typeof next === "function" ? next(current) : next;
          out.set(STEAM_CATALOG_URL_PAGE, String(Math.max(1, resolved)));
          return out;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const toggleGenre = useCallback(
    (label: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const genres = [...prev.getAll(STEAM_CATALOG_URL_GENRE)];
          const i = genres.indexOf(label);
          if (i >= 0) genres.splice(i, 1);
          else genres.push(label);
          setRepeatedParam(next, STEAM_CATALOG_URL_GENRE, genres);
          next.set(STEAM_CATALOG_URL_PAGE, "1");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const toggleTag = useCallback(
    (label: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const tags = [...prev.getAll(STEAM_CATALOG_URL_TAG)];
          const i = tags.indexOf(label);
          if (i >= 0) tags.splice(i, 1);
          else tags.push(label);
          setRepeatedParam(next, STEAM_CATALOG_URL_TAG, tags);
          next.set(STEAM_CATALOG_URL_PAGE, "1");
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const clearFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(STEAM_CATALOG_URL_GENRE);
        next.delete(STEAM_CATALOG_URL_TAG);
        next.set(STEAM_CATALOG_URL_PAGE, "1");
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams]);

  const setSearchTerm = useCallback((value: string) => {
    setSearchInput(value);
  }, []);

  const filterSignature = `${genresKey}|${tagsKey}`;

  const rangeStart = items.length > 0 ? (page - 1) * STEAM_CATALOG_PAGE_SIZE + 1 : 0;
  const rangeEnd = searchMode
    ? Math.min(page * STEAM_CATALOG_PAGE_SIZE, totalSearch)
    : Math.min(page * STEAM_CATALOG_PAGE_SIZE, totalBrowse);
  const totalForRange = searchMode ? totalSearch : totalBrowse;

  return {
    searchTerm: searchInput,
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
    isListRefetching,
    facets: facetsQuery.data ?? null,
    facetsLoading: facetsQuery.isPending,
    selectedGenres,
    selectedTags,
    toggleGenre,
    toggleTag,
    clearFilters,
  };
}
