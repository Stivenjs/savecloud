import { useQuery } from "@tanstack/react-query";
import { getConfig } from "@services/tauri";

export const CONFIG_QUERY_KEY = ["config"] as const;

export function useConfig() {
  const {
    data: config,
    isLoading: loading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: getConfig,
    staleTime: 2 * 60 * 1000,
    retry: 1,
  });

  return {
    config: config ?? null,
    loading,
    error: isError ? (error instanceof Error ? error.message : String(error)) : null,
    refetch,
    isStale: !config,
  };
}
