import { useEffect, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { sendCloudStreamSignal } from "@services/tauri";
import { useProfileSession } from "@hooks/useProfileSession";
import { useConfig } from "@hooks/useConfig";
import { useCloudStreamStore } from "@store/CloudStreamStore";
import { clearHostStreamRuntime, getHostStreamRuntime } from "@features/friends/streamRuntime";

const MAX_VIEWERS = 4;

interface StreamSignalPayload {
  fromUserId?: string;
  targetUserId?: string | null;
  event?: string;
  streamId?: string;
  payload?: {
    sdp?: string;
    type?: RTCSdpType;
    candidate?: RTCIceCandidateInit;
  } & Record<string, unknown>;
}

interface CloudIncomingMessage {
  type: "FRIEND_PLAYING" | "PRESENCE_UPDATE" | "ERROR" | "STREAM_SIGNAL";
  data?: StreamSignalPayload;
}

function isRtcSdpType(value: unknown): value is RTCSdpType {
  return value === "offer" || value === "pranswer" || value === "answer" || value === "rollback";
}

function createPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({
    iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
  });
}

export function useCloudStreamHostSignaling() {
  const { activeProfile } = useProfileSession();
  const { config } = useConfig();
  const upsertStream = useCloudStreamStore((state) => state.upsertStream);
  const setViewerCount = useCloudStreamStore((state) => state.setViewerCount);

  const localUserId = useMemo(
    () => (activeProfile?.localUserId || config?.userId || "").trim(),
    [activeProfile?.localUserId, config?.userId]
  );

  useEffect(() => {
    if (!localUserId) return;

    let unlistenIncoming: (() => void) | undefined;

    const syncViewerCount = async (streamId: string, viewerCount: number) => {
      setViewerCount(streamId, viewerCount);
      await sendCloudStreamSignal({
        event: "STREAM_VIEWERS",
        streamId,
        payload: { viewerCount, maxViewers: MAX_VIEWERS },
      });
    };

    const handleJoin = async (signal: StreamSignalPayload) => {
      const streamId = signal.streamId?.trim();
      const viewerUserId = signal.fromUserId?.trim();
      if (!streamId || !viewerUserId) return;

      const stream = useCloudStreamStore
        .getState()
        .streams.find((item) => item.streamId === streamId && item.hostUserId === localUserId);
      if (!stream) return;

      const runtime = getHostStreamRuntime(streamId);
      if (!runtime) {
        await sendCloudStreamSignal({
          event: "STREAM_JOIN_REJECTED",
          streamId,
          targetUserId: viewerUserId,
          payload: { reason: "host_not_ready" },
        });
        return;
      }

      if (runtime.viewers.has(viewerUserId)) {
        return;
      }

      if (runtime.viewers.size >= MAX_VIEWERS) {
        await sendCloudStreamSignal({
          event: "STREAM_JOIN_REJECTED",
          streamId,
          targetUserId: viewerUserId,
          payload: { reason: "stream_full", maxViewers: MAX_VIEWERS },
        });
        return;
      }

      const peer = createPeerConnection();
      runtime.peers.set(viewerUserId, peer);
      runtime.viewers.add(viewerUserId);

      for (const track of runtime.mediaStream.getTracks()) {
        peer.addTrack(track, runtime.mediaStream);
      }

      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        void sendCloudStreamSignal({
          event: "STREAM_ICE",
          streamId,
          targetUserId: viewerUserId,
          payload: { candidate: event.candidate.toJSON() },
        });
      };

      peer.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
          const runtimeRef = getHostStreamRuntime(streamId);
          if (!runtimeRef) return;
          const peerRef = runtimeRef.peers.get(viewerUserId);
          if (peerRef) {
            peerRef.close();
            runtimeRef.peers.delete(viewerUserId);
          }
          runtimeRef.viewers.delete(viewerUserId);
          void syncViewerCount(streamId, runtimeRef.viewers.size);
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendCloudStreamSignal({
        event: "STREAM_OFFER",
        streamId,
        targetUserId: viewerUserId,
        payload: {
          sdp: offer.sdp,
          type: offer.type,
        },
      });

      await syncViewerCount(streamId, runtime.viewers.size);
      upsertStream({
        ...stream,
        viewerCount: runtime.viewers.size,
        maxViewers: MAX_VIEWERS,
      });
    };

    const handleAnswer = async (signal: StreamSignalPayload) => {
      const streamId = signal.streamId?.trim();
      const viewerUserId = signal.fromUserId?.trim();
      const payload = signal.payload;
      const answerType = payload?.type;
      const answerSdp = payload?.sdp;
      if (!streamId || !viewerUserId || !answerSdp || !isRtcSdpType(answerType)) return;

      const runtime = getHostStreamRuntime(streamId);
      const peer = runtime?.peers.get(viewerUserId);
      if (!peer) return;

      await peer.setRemoteDescription(
        new RTCSessionDescription({
          type: answerType,
          sdp: answerSdp,
        })
      );
    };

    const handleIce = async (signal: StreamSignalPayload) => {
      const streamId = signal.streamId?.trim();
      const viewerUserId = signal.fromUserId?.trim();
      const payload = signal.payload;
      if (!streamId || !viewerUserId || !payload?.candidate) return;

      const runtime = getHostStreamRuntime(streamId);
      const peer = runtime?.peers.get(viewerUserId);
      if (!peer) return;

      await peer.addIceCandidate(new RTCIceCandidate(payload.candidate));
    };

    const handleLeave = async (signal: StreamSignalPayload) => {
      const streamId = signal.streamId?.trim();
      const viewerUserId = signal.fromUserId?.trim();
      if (!streamId || !viewerUserId) return;

      const runtime = getHostStreamRuntime(streamId);
      if (!runtime) return;

      const peer = runtime.peers.get(viewerUserId);
      if (peer) {
        peer.close();
        runtime.peers.delete(viewerUserId);
      }
      runtime.viewers.delete(viewerUserId);

      await syncViewerCount(streamId, runtime.viewers.size);
    };

    const setupListener = async () => {
      unlistenIncoming = await listen<CloudIncomingMessage>("cloud-ws-incoming", (event) => {
        const incoming = event.payload;
        if (incoming?.type !== "STREAM_SIGNAL") return;

        const signal = incoming.data;
        if (!signal?.streamId || !signal.event) return;

        const target = signal.targetUserId?.trim();
        if (target && target !== localUserId) return;

        if (signal.event === "STREAM_JOIN") {
          void handleJoin(signal);
          return;
        }

        if (signal.event === "STREAM_ANSWER") {
          void handleAnswer(signal);
          return;
        }

        if (signal.event === "STREAM_ICE") {
          void handleIce(signal);
          return;
        }

        if (signal.event === "STREAM_LEAVE") {
          void handleLeave(signal);
          return;
        }

        if (signal.event === "STREAM_ENDED") {
          clearHostStreamRuntime(signal.streamId, true);
        }
      });
    };

    void setupListener();

    return () => {
      unlistenIncoming?.();
    };
  }, [config?.userId, localUserId, setViewerCount, upsertStream, activeProfile?.localUserId]);
}
