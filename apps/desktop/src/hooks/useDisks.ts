import { useQuery } from "@tanstack/react-query";
import { getAvailableDisks } from "@services/tauri";
import type { DiskInfo } from "@services/tauri";

export const DISKS_QUERY_KEY = ["system", "disks"] as const;

export function useDisks() {
  const {
    data: disks,
    isLoading,
    isError,
    error,
    refetch: refreshDisks,
  } = useQuery<DiskInfo[]>({
    queryKey: DISKS_QUERY_KEY,
    queryFn: getAvailableDisks,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });

  return {
    disks: (disks ?? []) as DiskInfo[],
    isLoading,
    error: isError ? (error instanceof Error ? error.message : String(error)) : null,
    refreshDisks,
  };
}
