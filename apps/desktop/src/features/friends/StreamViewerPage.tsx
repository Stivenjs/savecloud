import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { listen } from "@tauri-apps/api/event";
import { MonitorPlay } from "lucide-react";
import { sendCloudStreamSignal } from "@services/tauri";
import { useAppInitialization } from "@hooks/useAppInitialization";
import { useProfileSession, useProfileSessionHydration } from "@hooks/useProfileSession";
import { useConfig } from "@hooks/useConfig";

interface StreamSignalPayload {
  fromUserId?: string;
  targetUserId?: string | null;
  event?: string;
  streamId?: string;
  payload?: {
    sdp?: string;
    type?: RTCSdpType;
    candidate?: RTCIceCandidateInit;
    reason?: string;
  };
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

export function StreamViewerPage() {
  useProfileSessionHydration();
  useAppInitialization();

  const { activeProfile } = useProfileSession();
  const { config } = useConfig();

  const localUserId = useMemo(
    () => (activeProfile?.localUserId || config?.userId || "").trim(),
    [activeProfile?.localUserId, config?.userId]
  );

  const [status, setStatus] = useState("Esperando señal de stream...");
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);

  const params = useMemo(() => new URLSearchParams(window.location.search), []);

  const streamId = useMemo(() => params.get("streamId")?.trim() ?? "", [params]);
  const hostUserId = useMemo(() => params.get("hostUserId")?.trim() ?? "", [params]);

  useEffect(() => {
    if (!streamId || !hostUserId || !localUserId) return;

    let unlistenIncoming: (() => void) | undefined;

    const ensurePeer = () => {
      if (peerRef.current) return peerRef.current;

      const peer = createPeerConnection();
      peerRef.current = peer;

      peer.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (videoRef.current && remoteStream) {
          videoRef.current.srcObject = remoteStream;
          setStatus("Conectado al stream");
          setIsConnected(true);
        }
      };

      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        void sendCloudStreamSignal({
          event: "STREAM_ICE",
          streamId,
          targetUserId: hostUserId,
          payload: {
            candidate: event.candidate.toJSON(),
          },
        });
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setStatus("Conectado al stream");
          setIsConnected(true);
          return;
        }
        if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
          setStatus("Conexión de stream cerrada");
          setIsConnected(false);
        }
      };

      return peer;
    };

    const sendJoinWithRetry = async (attempt = 0): Promise<void> => {
      try {
        await sendCloudStreamSignal({
          event: "STREAM_JOIN",
          streamId,
          targetUserId: hostUserId,
        });
        setStatus("Solicitando acceso al stream...");
      } catch {
        if (attempt >= 2) {
          setError("No se pudo solicitar unión al stream.");
          return;
        }
        window.setTimeout(() => {
          void sendJoinWithRetry(attempt + 1);
        }, 600);
      }
    };

    const setupListener = async () => {
      unlistenIncoming = await listen<CloudIncomingMessage>("cloud-ws-incoming", (event) => {
        const incoming = event.payload;
        if (incoming?.type !== "STREAM_SIGNAL") return;

        const signal = incoming.data;
        if (!signal?.streamId || signal.streamId !== streamId || !signal.event) return;

        if (signal.event === "STREAM_JOIN_REJECTED" && signal.targetUserId === localUserId) {
          setError(
            signal.payload?.reason === "stream_full" ? "La transmisión está llena (4 viewers)." : "Host no disponible."
          );
          setStatus("No se pudo unir");
          return;
        }

        if (
          signal.event === "STREAM_OFFER" &&
          signal.fromUserId === hostUserId &&
          signal.targetUserId === localUserId
        ) {
          const payload = signal.payload;
          const remoteType = payload?.type;
          const remoteSdp = payload?.sdp;
          if (!remoteSdp || !isRtcSdpType(remoteType)) return;

          const peer = ensurePeer();
          void (async () => {
            await peer.setRemoteDescription(
              new RTCSessionDescription({
                type: remoteType,
                sdp: remoteSdp,
              })
            );

            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);

            await sendCloudStreamSignal({
              event: "STREAM_ANSWER",
              streamId,
              targetUserId: hostUserId,
              payload: {
                sdp: answer.sdp,
                type: answer.type,
              },
            });
          })().catch(() => {
            setError("No se pudo completar la negociación WebRTC.");
          });
          return;
        }

        if (signal.event === "STREAM_ICE" && signal.fromUserId === hostUserId && signal.targetUserId === localUserId) {
          const payload = signal.payload;
          if (!payload?.candidate) return;

          const peer = ensurePeer();
          void peer.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {
            setError("No se pudo aplicar ICE candidate del host.");
          });
          return;
        }

        if (signal.event === "STREAM_ENDED") {
          setStatus("La transmisión finalizó.");
          setIsConnected(false);
          const peer = peerRef.current;
          if (peer) {
            peer.close();
            peerRef.current = null;
          }
          if (videoRef.current) {
            videoRef.current.srcObject = null;
          }
        }
      });
    };

    void setupListener();
    void sendJoinWithRetry();

    return () => {
      unlistenIncoming?.();

      const peer = peerRef.current;
      if (peer) {
        peer.close();
        peerRef.current = null;
      }

      void sendCloudStreamSignal({
        event: "STREAM_LEAVE",
        streamId,
        targetUserId: hostUserId,
      });
    };
  }, [hostUserId, localUserId, streamId]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-3xl rounded-2xl border border-default-200/80 bg-default-50/35 p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2 text-foreground">
          <MonitorPlay className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Visor de transmisión</h1>
        </div>

        <div className="space-y-2 rounded-xl border border-default-200/70 bg-background/80 p-4 text-sm text-default-600">
          <p>
            <strong className="text-foreground">Host:</strong> {hostUserId || "desconocido"}
          </p>
          <p>
            <strong className="text-foreground">Stream ID:</strong> {streamId || "sin stream"}
          </p>
          <p>
            <strong className="text-foreground">Estado:</strong> {status}
          </p>
          {error ? (
            <p className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-danger">{error}</p>
          ) : null}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-default-200/70 bg-black/80">
          <video ref={videoRef} className="h-105 w-full object-contain" autoPlay playsInline controls={!isConnected} />
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-default-500">
            {isConnected ? "Reproduciendo en tiempo real" : "Esperando conexión P2P..."}
          </span>
          <Button color="primary" variant="flat" onPress={() => window.close()}>
            Cerrar ventana
          </Button>
        </div>
      </div>
    </div>
  );
}
