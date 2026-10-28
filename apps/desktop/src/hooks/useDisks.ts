import { useQuery } from "@tanstack/react-query";
import { getAvailableDisks } from "@services/tauri";
import type { DiskInfo } from "@services/tauri";
import { getUnknownErrorMessage } from "@utils/errorMessage";

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
    error: isError ? getUnknownErrorMessage(error) : null,
    refreshDisks,
  };
}
