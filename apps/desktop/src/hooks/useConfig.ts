import { useQuery } from "@tanstack/react-query";
import { getConfig } from "@services/tauri";
import { listen } from "@tauri-apps/api/event";
import { queryClient } from "@lib/queryClient";
import { LIBRARY_PAGE_QUERY_KEY, useLibraryPage } from "@hooks/useLibraryPage";

export const CONFIG_QUERY_KEY = ["config"] as const;

let isConfigListenerRegistered = false;

function registerConfigListener() {
  if (isConfigListenerRegistered) return;
  isConfigListenerRegistered = true;
  void listen("config-changed", () => {
    void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: LIBRARY_PAGE_QUERY_KEY });
  });
}

if (typeof window !== "undefined") {
  registerConfigListener();
}

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
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });
  const libraryPage = useLibraryPage("");
  const configWithLibraryPage = config ? { ...config, games: libraryPage.games } : null;

  return {
    config: configWithLibraryPage,
    loading: loading || libraryPage.loading,
    error: isError ? (error instanceof Error ? error.message : String(error)) : libraryPage.error,
    refetch,
    isStale: !config,
  };
}
