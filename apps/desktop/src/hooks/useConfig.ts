import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getConfig } from "@services/tauri";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";

export const CONFIG_QUERY_KEY = ["config"] as const;

export function useConfig() {
  const qc = useQueryClient();
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

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen("config-changed", () => {
      void qc.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
      void refetch();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [qc, refetch]);

  return {
    config: config ?? null,
    loading,
    error: isError ? (error instanceof Error ? error.message : String(error)) : null,
    refetch,
    isStale: !config,
  };
}
