import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { detectEmulators, type EmulatorProgressPayload } from "@services/tauri/emulators.service";
import type { EmulatorProgressById, EmulatorStatuses } from "../types/emulatorCatalog";

/** Consulta las rutas detectadas y recibe cambios de instalación/configuración desde Tauri. */
export function useEmulatorStatuses() {
  const queryClient = useQueryClient();
  const [progresses, setProgresses] = useState<EmulatorProgressById>({});
  const query = useQuery<EmulatorStatuses>({
    queryKey: ["emulators-status"],
    queryFn: detectEmulators,
    retry: 1,
  });

  const refreshStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["emulators-status"] });
  }, [queryClient]);

  useEffect(() => {
    let active = true;
    let unlistenProgress: (() => void) | undefined;
    let unlistenConfig: (() => void) | undefined;

    void listen<EmulatorProgressPayload>("emulator-download-progress", (event) => {
      const payload = event.payload;
      setProgresses((previous) => ({ ...previous, [payload.emulator]: payload }));
      if (payload.status === "finished" || payload.status === "failed") refreshStatus();
    }).then((unlisten) => {
      if (active) unlistenProgress = unlisten;
      else unlisten();
    });

    void listen("config-changed", refreshStatus).then((unlisten) => {
      if (active) unlistenConfig = unlisten;
      else unlisten();
    });

    return () => {
      active = false;
      unlistenProgress?.();
      unlistenConfig?.();
    };
  }, [refreshStatus]);

  return {
    statuses: query.data ?? {},
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    progresses,
    setProgresses,
    refreshStatus,
  };
}
