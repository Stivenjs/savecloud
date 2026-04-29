import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { NOTIFICATIONS_CHANGED_EVENT } from "@services/tauri/notifications.service";
import { fetchMergedObservability, OBSERVABILITY_HEALTH_QUERY_KEY } from "@services/tauri/observability.service";

export function useObservabilityHealth(window: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const cleanups: Array<Promise<() => void>> = [];

    cleanups.push(
      listen("cloud-ws-incoming", () => {
        if (!cancelled) {
          void queryClient.invalidateQueries({ queryKey: [...OBSERVABILITY_HEALTH_QUERY_KEY] });
        }
      })
    );
    cleanups.push(
      listen(NOTIFICATIONS_CHANGED_EVENT, () => {
        if (!cancelled) {
          void queryClient.invalidateQueries({ queryKey: [...OBSERVABILITY_HEALTH_QUERY_KEY] });
        }
      })
    );

    return () => {
      cancelled = true;
      for (const p of cleanups) {
        void p.then((u) => u());
      }
    };
  }, [queryClient]);

  return useQuery({
    queryKey: [...OBSERVABILITY_HEALTH_QUERY_KEY, window],
    queryFn: () => fetchMergedObservability(window),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: 1,
  });
}
