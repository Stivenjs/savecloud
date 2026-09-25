import { useQuery } from "@tanstack/react-query";
import { getLibrary } from "@services/tauri/config.service";

export const LIBRARY_QUERY_KEY = ["library"] as const;

export function useLibrary() {
  const query = useQuery({
    queryKey: LIBRARY_QUERY_KEY,
    queryFn: getLibrary,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return {
    games: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : query.error ? String(query.error) : null,
    refetch: query.refetch,
  };
}
