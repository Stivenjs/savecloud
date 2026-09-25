import { useInfiniteQuery } from "@tanstack/react-query";
import { getLibraryPage } from "@services/tauri/config.service";

const LIBRARY_PAGE_SIZE = 100;
export const LIBRARY_PAGE_QUERY_KEY = ["library-page"] as const;

export function useLibraryPage(search: string) {
  const query = useInfiniteQuery({
    queryKey: [...LIBRARY_PAGE_QUERY_KEY, search, LIBRARY_PAGE_SIZE],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => getLibraryPage({ offset: pageParam, search, limit: LIBRARY_PAGE_SIZE }),
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.games.length;
      return nextOffset < lastPage.total ? nextOffset : undefined;
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const pages = query.data?.pages ?? [];

  return {
    games: pages.flatMap((page) => page.games),
    total: pages[0]?.total ?? 0,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    refetch: query.refetch,
    loadMore: query.fetchNextPage,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
  };
}
