import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";

interface CloudIncomingMessage {
  type: "FRIEND_PLAYING" | "PRESENCE_UPDATE" | "ERROR";
}

export function useCloudPresenceRealtimeInvalidation(enabled = true) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) return;

    let unlistenIncoming: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlistenIncoming = await listen<CloudIncomingMessage>("cloud-ws-incoming", (event) => {
          if (event.payload?.type === "FRIEND_PLAYING" || event.payload?.type === "PRESENCE_UPDATE") {
            queryClient.invalidateQueries({ queryKey: ["cloud-presence"] });
          }
        });
      } catch {
        // Fallback: polling de query.
      }
    };

    void setupListener();

    return () => {
      unlistenIncoming?.();
    };
  }, [enabled, queryClient]);
}
