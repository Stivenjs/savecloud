import { useQuery } from "@tanstack/react-query";
import { getConfig } from "@services/tauri";

const CONFIG_QUERY_KEY = ["config"] as const;

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
    /** Cache: no refetch automático hasta 2 min; la config cambia al guardar y se invalida desde ahí. */
    staleTime: 2 * 60 * 1000,
  });

  return {
    config: config ?? null,
    loading,
    error: isError
      ? error instanceof Error
        ? error.message
        : String(error)
      : null,
    refetch,
  };
}
