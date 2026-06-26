import { useQuery } from "@tanstack/react-query";
import { getConfig } from "@services/tauri";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { queryClient } from "@lib/queryClient";

export const CONFIG_QUERY_KEY = ["config"] as const;

let isConfigListenerRegistered = false;

function registerConfigListener() {
  if (isConfigListenerRegistered) return;
  isConfigListenerRegistered = true;
  void listen("config-changed", () => {
    void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
  });
}

export function useConfig() {
  useEffect(() => {
    registerConfigListener();
  }, []);

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

  return {
    config: config ?? null,
    loading,
    error: isError ? (error instanceof Error ? error.message : String(error)) : null,
    refetch,
    isStale: !config,
  };
}
