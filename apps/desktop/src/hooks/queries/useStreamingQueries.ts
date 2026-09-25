import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export type StreamingState =
  | "NotInstalled"
  | "Stopped"
  | "Running"
  | { Hosting: { pin: string; clients: string[] } }
  | { Playing: { host_ip: string; ws_port: number } }
  | { Error: string }
  | "Idle";

export const STREAMING_KEYS = {
  all: ["streaming"] as const,
  state: () => [...STREAMING_KEYS.all, "state"] as const,
};

/**
 * Hook centralizado para consultar y sincronizar el estado del motor de streaming.
 * Evita la duplicación de escuchadores de eventos e invalidaciones redundantes.
 */
export function useStreamingState() {
  const queryClient = useQueryClient();

  const query = useQuery<StreamingState>({
    queryKey: STREAMING_KEYS.state(),
    queryFn: () => invoke("streaming_get_state"),
    staleTime: 30_000,
  });

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isSubscribed = true;

    void listen("streaming-state-changed", () => {
      if (isSubscribed) {
        void queryClient.invalidateQueries({ queryKey: STREAMING_KEYS.state() });
      }
    }).then((fn) => {
      if (isSubscribed) {
        unlisten = fn;
      } else {
        fn();
      }
    });

    return () => {
      isSubscribed = false;
      unlisten?.();
    };
  }, [queryClient]);

  return query;
}
