import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/react";
import { listen } from "@tauri-apps/api/event";
import { MonitorPlay } from "lucide-react";
import { sendCloudStreamSignal } from "@services/tauri";
import { useAppInitialization } from "@hooks/useAppInitialization";
import { useProfileSession, useProfileSessionHydration } from "@hooks/useProfileSession";
import { useConfig } from "@hooks/useConfig";
import { TitleBar } from "@components/layout/TitleBar";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";

// EXPERIMENTAL: Stream viewer window used for development/testing only.

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

type StreamStatus = "waiting" | "connected" | "closed" | "requesting" | "failed" | "ended";

const STATUS_KEYS: Record<StreamStatus, string> = {
  waiting: "friends.streamViewer.status.waiting",
  connected: "friends.streamViewer.status.connected",
  closed: "friends.streamViewer.status.closed",
  requesting: "friends.streamViewer.status.requesting",
  failed: "friends.streamViewer.status.failed",
  ended: "friends.streamViewer.status.ended",
};

export function StreamViewerPage() {
  useProfileSessionHydration();
  useAppInitialization();
  const { t } = useTranslation();

  const { activeProfile } = useProfileSession();
  const { config } = useConfig();

  const localUserId = useMemo(
    () => (activeProfile?.localUserId || config?.userId || "").trim(),
    [activeProfile?.localUserId, config?.userId]
  );

  const [status, setStatus] = useState<StreamStatus>("waiting");
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const remoteStreamRef = useRef<MediaStream>(new MediaStream());

  const params = useMemo(() => new URLSearchParams(window.location.search), []);

  const streamId = useMemo(() => params.get("streamId")?.trim() ?? "", [params]);
  const hostUserId = useMemo(() => params.get("hostUserId")?.trim() ?? "", [params]);

  useEffect(() => {
    void getCurrentWindow().setTitle(`${t("friends.streamViewer.title")} · ${hostUserId}`);
  }, [t, hostUserId]);

  useEffect(() => {
    if (!streamId || !hostUserId || !localUserId) return;

    let unlistenIncoming: (() => void) | null = null;

    const pushDebugLog = (msg: string) => {
      setDebugLogs((logs) => [...logs.slice(-30), `[${new Date().toLocaleTimeString()}] ${msg}`]);
    };

    const ensurePeer = (): RTCPeerConnection => {
      if (peerRef.current) return peerRef.current;

      pushDebugLog("Iniciando conexión peer RTCPeerConnection");
      const peer = createPeerConnection();
      peerRef.current = peer;

      peer.ontrack = (event) => {
        const track = event.track;
        const remoteStream = remoteStreamRef.current;
        pushDebugLog(`Track remoto detectado id=${track.id} kind=${track.kind}`);

        if (track.kind === "video") {
          remoteStream.addTrack(track);
        }

        if (videoRef.current && videoRef.current.srcObject !== remoteStream) {
          videoRef.current.srcObject = remoteStream;

          window.setTimeout(() => {
            void videoRef.current?.play().catch(() => {
              pushDebugLog("video.play() falló en ontrack");
              // Si el WebView bloquea play() por política temporal, el track sigue adjunto.
            });
          }, 0);

          setStatus("connected");
          setIsConnected(true);
        }
      };

      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        pushDebugLog("ICE local generado y enviado al host");
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
        pushDebugLog(`connectionState=${peer.connectionState}`);
        if (peer.connectionState === "connected") {
          setStatus("connected");
          setIsConnected(true);
          return;
        }
        if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
          setStatus("closed");
          setIsConnected(false);
        }
      };

      return peer;
    };

    const flushPendingIceCandidates = async (peer: RTCPeerConnection) => {
      const pending = [...pendingIceCandidatesRef.current];
      pendingIceCandidatesRef.current = [];

      if (pending.length > 0) {
        pushDebugLog(`Aplicando ${pending.length} ICE candidates pendientes`);
      }

      for (const candidate of pending) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    };

    const sendJoinWithRetry = async (attempt = 0): Promise<void> => {
      try {
        pushDebugLog(`Enviando STREAM_JOIN intento=${attempt + 1}`);
        await sendCloudStreamSignal({
          event: "STREAM_JOIN",
          streamId,
          targetUserId: hostUserId,
        });
        setStatus("requesting");
      } catch {
        if (attempt >= 2) {
          setError(t("friends.streamViewer.errors.requestJoin"));
          pushDebugLog("Fallo definitivo al enviar STREAM_JOIN");
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

        pushDebugLog(
          `Señal recibida event=${signal.event} from=${signal.fromUserId ?? "-"} target=${signal.targetUserId ?? "-"}`
        );

        if (signal.event === "STREAM_JOIN_REJECTED" && signal.targetUserId === localUserId) {
          setError(
            signal.payload?.reason === "stream_full"
              ? t("friends.streamViewer.errors.streamFull")
              : t("friends.streamViewer.errors.hostUnavailable")
          );
          setStatus("failed");
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

          pushDebugLog(`STREAM_OFFER recibido type=${remoteType} sdpLen=${remoteSdp.length}`);

          const peer = ensurePeer();
          void (async () => {
            await peer.setRemoteDescription(
              new RTCSessionDescription({
                type: remoteType,
                sdp: remoteSdp,
              })
            );

            pushDebugLog("RemoteDescription aplicada");

            await flushPendingIceCandidates(peer);

            if (videoRef.current && videoRef.current.srcObject == null) {
              videoRef.current.srcObject = remoteStreamRef.current;
            }

            const answer = await peer.createAnswer();
            await peer.setLocalDescription(answer);

            pushDebugLog(`Answer creada y enviada type=${answer.type} sdpLen=${answer.sdp?.length ?? 0}`);

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
            setError(t("friends.streamViewer.errors.webrtcFailed"));
          });
          return;
        }

        if (signal.event === "STREAM_ICE" && signal.fromUserId === hostUserId && signal.targetUserId === localUserId) {
          const payload = signal.payload;
          if (!payload?.candidate) return;

          pushDebugLog(`ICE remoto recibido desde host (remoteDescription=${!!peerRef.current?.remoteDescription})`);

          const peer = ensurePeer();
          if (!peer.remoteDescription) {
            pendingIceCandidatesRef.current.push(payload.candidate);
            pushDebugLog("ICE encolado porque aún no hay remoteDescription");
            return;
          }

          void peer.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {
            setError("No se pudo aplicar ICE candidate del host.");
            pushDebugLog("Fallo al aplicar ICE remoto");
          });
          return;
        }

        if (signal.event === "STREAM_ENDED") {
          setStatus("ended");
          setIsConnected(false);
          pushDebugLog("STREAM_ENDED recibido");
          const peer = peerRef.current;
          if (peer) {
            peer.close();
            peerRef.current = null;
          }
          pendingIceCandidatesRef.current = [];
          remoteStreamRef.current = new MediaStream();
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
      pendingIceCandidatesRef.current = [];
      remoteStreamRef.current = new MediaStream();

      void sendCloudStreamSignal({
        event: "STREAM_LEAVE",
        streamId,
        targetUserId: hostUserId,
      });
    };
  }, [hostUserId, localUserId, streamId, t]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-6 pt-20 pb-10">
      <TitleBar />
      <div className="w-full max-w-3xl rounded-2xl border border-default-200/80 bg-default-50/35 p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-2 text-foreground">
          <MonitorPlay className="h-5 w-5" />
          <h1 className="text-lg font-semibold">{t("friends.streamViewer.title")}</h1>
        </div>

        <div className="space-y-2 rounded-xl border border-default-200/70 bg-background/80 p-4 text-sm text-default-600">
          <p>
            <strong className="text-foreground">{t("friends.streamViewer.host")}:</strong>{" "}
            {hostUserId || t("friends.streamViewer.unknown")}
          </p>
          <p>
            <strong className="text-foreground">{t("friends.streamViewer.streamId")}:</strong>{" "}
            {streamId || t("friends.streamViewer.noStream")}
          </p>
          <p>
            <strong className="text-foreground">{t("friends.streamViewer.statusLabel")}:</strong>{" "}
            {t(STATUS_KEYS[status])}
          </p>
          {error ? (
            <p className="rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-danger">{error}</p>
          ) : null}
        </div>

        <div className="mt-4 overflow-hidden rounded-xl border border-default-200/70 bg-black/80">
          <video
            ref={videoRef}
            className="h-105 w-full object-contain"
            autoPlay
            playsInline
            controls={!isConnected}
            onLoadedMetadata={() => {
              void videoRef.current?.play().catch(() => {
                // El stream sigue cargado; el usuario puede arrancarlo manualmente con controles.
              });
            }}
            onCanPlay={() => {
              void videoRef.current?.play().catch(() => {
                // Si el autoplay aún no engancha, el control manual queda disponible.
              });
            }}
          />
        </div>

        <div className="mt-3 rounded-xl border border-default-200/70 bg-background/75 p-3 text-[11px] text-default-500">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium text-default-600">{t("friends.streamViewer.debugLog")}</span>
            <span>{t("friends.streamViewer.eventCount", { count: debugLogs.length })}</span>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto font-mono">
            {debugLogs.length ? (
              debugLogs.map((entry, index) => (
                <div key={`${entry}-${index}`} className="wrap-break-word">
                  {entry}
                </div>
              ))
            ) : (
              <div>{t("friends.streamViewer.noEvents")}</div>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-xs text-default-500">
            {isConnected ? t("friends.streamViewer.playingRealtime") : t("friends.streamViewer.waitingP2P")}
          </span>
          <Button color="primary" variant="flat" onPress={() => window.close()}>
            {t("friends.streamViewer.closeWindow")}
          </Button>
        </div>
      </div>
    </div>
  );
}
