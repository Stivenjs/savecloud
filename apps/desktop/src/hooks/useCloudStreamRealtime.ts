import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useCloudStreamStore } from "@store/CloudStreamStore";

// EXPERIMENTAL: realtime stream store synchronization for prototype signaling.

interface StreamSignalPayload {
  fromUserId?: string;
  event?: string;
  streamId?: string;
  payload?: {
    startedAt?: number;
    qualityPreset?: string;
    hasSystemAudio?: boolean;
    hasMicAudio?: boolean;
    viewerCount?: number;
    maxViewers?: number;
  };
}

interface CloudIncomingMessage {
  type: "FRIEND_PLAYING" | "PRESENCE_UPDATE" | "ERROR" | "STREAM_SIGNAL";
  data?: StreamSignalPayload;
}

export function useCloudStreamRealtime() {
  const upsertStream = useCloudStreamStore((state) => state.upsertStream);
  const removeStream = useCloudStreamStore((state) => state.removeStream);
  const setViewerCount = useCloudStreamStore((state) => state.setViewerCount);

  useEffect(() => {
    let unlistenIncoming: (() => void) | undefined;

    const setupListener = async () => {
      try {
        unlistenIncoming = await listen<CloudIncomingMessage>("cloud-ws-incoming", (event) => {
          const incoming = event.payload;
          if (incoming?.type !== "STREAM_SIGNAL") return;

          const signal = incoming.data;
          if (!signal?.streamId) return;

          if (signal.event === "STREAM_CREATED") {
            upsertStream({
              streamId: signal.streamId,
              hostUserId: signal.fromUserId ?? "unknown",
              startedAt: signal.payload?.startedAt ?? Date.now(),
              qualityPreset: signal.payload?.qualityPreset ?? "1080p30-h264",
              hasSystemAudio: signal.payload?.hasSystemAudio ?? true,
              hasMicAudio: signal.payload?.hasMicAudio ?? false,
              viewerCount: 0,
              maxViewers: signal.payload?.maxViewers ?? 4,
            });
            return;
          }

          if (signal.event === "STREAM_VIEWERS") {
            setViewerCount(signal.streamId, Math.max(0, Number(signal.payload?.viewerCount ?? 0)));
            return;
          }

          if (signal.event === "STREAM_ENDED") {
            removeStream(signal.streamId);
          }
        });
      } catch {
        // Sin listener realtime: el store se alimenta con acciones locales.
      }
    };

    void setupListener();

    return () => {
      unlistenIncoming?.();
    };
  }, [removeStream, setViewerCount, upsertStream]);
}
