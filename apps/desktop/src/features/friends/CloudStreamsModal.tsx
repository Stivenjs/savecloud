import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Modal, ModalBody, ModalContent, ModalHeader, Spinner, useDraggable } from "@heroui/react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Eye, Radio, RadioTower, Square, Video, X } from "lucide-react";
import { sendCloudStreamSignal } from "@services/tauri";
import { useRegisterGlobalBack } from "@hooks/useRegisterGlobalBack";
import { useProfileSession } from "@hooks/useProfileSession";
import { useConfig } from "@hooks/useConfig";
import { useCloudStreamStore } from "@store/CloudStreamStore";
import {
  clearHostStreamRuntime,
  getHostStreamRuntime,
  registerHostStreamRuntime,
} from "@features/friends/streamRuntime";
import {
  StreamQualityControls,
  type StreamFpsPreset,
  type StreamResolutionPreset,
} from "@features/friends/StreamQualityControls";

const MAX_VIEWERS = 4;
const RESOLUTION_MAP: Record<StreamResolutionPreset, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
};

interface CloudStreamsModalProps {
  isOpen: boolean;
  onClose: () => void;
  modalRef: React.RefObject<HTMLElement>;
}

export function CloudStreamsModal({ isOpen, onClose, modalRef }: CloudStreamsModalProps) {
  const { activeProfile } = useProfileSession();
  const { config } = useConfig();
  const streams = useCloudStreamStore((state) => state.streams);
  const upsertStream = useCloudStreamStore((state) => state.upsertStream);
  const removeStream = useCloudStreamStore((state) => state.removeStream);
  const setActiveHostedStreamId = useCloudStreamStore((state) => state.setActiveHostedStreamId);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [selectedResolution, setSelectedResolution] = useState<StreamResolutionPreset>("1080p");
  const [selectedFps, setSelectedFps] = useState<StreamFpsPreset>(30);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  const localUserId = useMemo(
    () => (activeProfile?.localUserId || config?.userId || "").trim(),
    [activeProfile?.localUserId, config?.userId]
  );

  const myStream = useMemo(() => streams.find((stream) => stream.hostUserId === localUserId), [localUserId, streams]);

  const sortedStreams = useMemo(() => [...streams].sort((a, b) => b.startedAt - a.startedAt), [streams]);

  const { moveProps } = useDraggable({
    targetRef: modalRef,
    canOverflow: false,
    isDisabled: !isOpen,
  });

  useRegisterGlobalBack(() => {
    if (!isOpen) return false;
    onClose();
    return true;
  });

  useEffect(() => {
    const videoEl = previewVideoRef.current;
    if (!videoEl) return;

    if (!previewEnabled || !myStream?.streamId) {
      videoEl.srcObject = null;
      return;
    }

    const runtime = getHostStreamRuntime(myStream.streamId);
    if (!runtime) {
      videoEl.srcObject = null;
      return;
    }

    videoEl.srcObject = runtime.mediaStream;
    videoEl.muted = true;
  }, [myStream?.streamId, previewEnabled]);

  const handleStartStream = async () => {
    if (!localUserId) {
      setError("No se pudo resolver tu usuario local para iniciar transmisión.");
      return;
    }
    if (myStream) {
      setError("Ya tienes una transmisión activa.");
      return;
    }

    const streamId = crypto.randomUUID();
    const startedAt = Date.now();

    setError(null);
    setIsLoading(true);

    try {
      const selectedSize = RESOLUTION_MAP[selectedResolution];
      const qualityPreset = `${selectedResolution}${selectedFps}-h264`;

      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: selectedFps, max: selectedFps },
          width: { ideal: selectedSize.width },
          height: { ideal: selectedSize.height },
        },
        audio: true,
      });

      let micStream: MediaStream | null = null;
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        // Micrófono opcional: si no se concede permiso, continuamos con audio del sistema.
      }

      const hasSystemAudio = displayStream.getAudioTracks().length > 0;
      const hasMicAudio = (micStream?.getAudioTracks().length ?? 0) > 0;

      let audioContext: AudioContext | null = null;
      let mixedAudioTrack: MediaStreamTrack | null = null;

      if (hasSystemAudio || hasMicAudio) {
        try {
          audioContext = new AudioContext();
          if (audioContext.state === "suspended") {
            await audioContext.resume();
          }

          const destination = audioContext.createMediaStreamDestination();

          if (hasSystemAudio) {
            const systemSource = audioContext.createMediaStreamSource(
              new MediaStream([displayStream.getAudioTracks()[0]])
            );
            const systemGain = audioContext.createGain();
            systemGain.gain.value = 1.0;
            systemSource.connect(systemGain).connect(destination);
          }

          if (hasMicAudio && micStream) {
            const micSource = audioContext.createMediaStreamSource(new MediaStream([micStream.getAudioTracks()[0]]));
            const micGain = audioContext.createGain();
            // Mic un poco por encima para que no quede tapado por audio del sistema.
            micGain.gain.value = 1.25;
            micSource.connect(micGain).connect(destination);
          }

          mixedAudioTrack = destination.stream.getAudioTracks()[0] ?? null;
        } catch {
          // Fallback por si WebAudio falla en el entorno actual.
          mixedAudioTrack = displayStream.getAudioTracks()[0] ?? micStream?.getAudioTracks()[0] ?? null;
        }
      }

      const merged = new MediaStream();
      for (const track of displayStream.getVideoTracks()) {
        merged.addTrack(track);
      }

      if (mixedAudioTrack) {
        merged.addTrack(mixedAudioTrack);
      }

      registerHostStreamRuntime(streamId, merged, () => {
        if (micStream) {
          for (const track of micStream.getTracks()) {
            track.stop();
          }
        }
        void audioContext?.close();
      });

      const screenVideoTrack = displayStream.getVideoTracks()[0];
      if (screenVideoTrack) {
        screenVideoTrack.addEventListener("ended", () => {
          void handleStopStream(streamId, true);
        });
      }

      await sendCloudStreamSignal({
        event: "STREAM_CREATED",
        streamId,
        payload: {
          startedAt,
          qualityPreset,
          hasSystemAudio,
          hasMicAudio,
          maxViewers: MAX_VIEWERS,
        },
      });

      // El host no recibe su propio fan-out, por eso se actualiza localmente.
      upsertStream({
        streamId,
        hostUserId: localUserId,
        startedAt,
        qualityPreset,
        hasSystemAudio,
        hasMicAudio,
        viewerCount: 0,
        maxViewers: MAX_VIEWERS,
      });
      setActiveHostedStreamId(streamId);
    } catch {
      setError("No se pudo iniciar la transmisión. Verifica conexión cloud activa.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleStopStream = async (streamId: string, silent = false) => {
    setError(null);
    setIsLoading(true);
    try {
      await sendCloudStreamSignal({
        event: "STREAM_ENDED",
        streamId,
      });
      clearHostStreamRuntime(streamId, true);
      removeStream(streamId);
      setActiveHostedStreamId(null);
      setPreviewEnabled(false);
    } catch {
      if (!silent) {
        setError("No se pudo detener la transmisión en este momento.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenViewer = async (streamId: string, hostUserId: string) => {
    const label = `stream-viewer-${streamId}`;
    const existing = await WebviewWindow.getByLabel(label);
    if (existing) {
      await existing.setFocus();
      return;
    }

    const url = `/?streamViewer=true&streamId=${encodeURIComponent(streamId)}&hostUserId=${encodeURIComponent(hostUserId)}`;

    const viewerWindow = new WebviewWindow(label, {
      title: `Ver transmisión · ${hostUserId}`,
      width: 1100,
      height: 760,
      url,
      resizable: true,
    });

    viewerWindow.once("tauri://error", () => {
      setError("No se pudo abrir la ventana de visualización.");
    });
  };

  const handleJoinStream = async (streamId: string, hostUserId: string) => {
    setError(null);
    try {
      await handleOpenViewer(streamId, hostUserId);
    } catch {
      setError("No se pudo abrir la ventana de visualización.");
    }
  };

  return (
    <Modal
      ref={modalRef}
      isOpen={isOpen}
      onOpenChange={(isOpenChange) => {
        if (!isOpenChange) onClose();
      }}
      isDismissable
      isKeyboardDismissDisabled={false}
      hideCloseButton
      backdrop="transparent"
      placement="center"
      classNames={{
        wrapper: "z-[9999]",
        base: "flex h-[min(82dvh,760px)] w-[min(90vw,460px)] flex-col overflow-hidden rounded-[18px] border border-default-200/80 bg-background/65 shadow-2xl backdrop-blur-md",
      }}>
      <ModalContent>
        {() => (
          <div className="relative h-full">
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="default"
              className="absolute right-2 top-2 z-20"
              aria-label="Cerrar modal de transmisiones"
              onPress={onClose}>
              <X className="h-4 w-4" />
            </Button>

            <ModalHeader
              {...moveProps}
              className="flex items-center justify-between gap-2 border-b border-default-200/70 pr-12">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-danger" />
                <span className="text-sm font-semibold">Transmisiones activas</span>
              </div>
              <div className="flex items-center gap-2">
                {myStream ? (
                  <>
                    <Button
                      size="sm"
                      variant="flat"
                      color="default"
                      startContent={<Eye className="h-4 w-4" />}
                      isDisabled={isLoading}
                      onPress={() => setPreviewEnabled((prev) => !prev)}>
                      {previewEnabled ? "Ocultar preview" : "Previsualizar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="flat"
                      color="danger"
                      startContent={<Square className="h-4 w-4" />}
                      isDisabled={isLoading}
                      onPress={() => handleStopStream(myStream.streamId)}>
                      Detener
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="solid"
                    color="primary"
                    startContent={<RadioTower className="h-4 w-4" />}
                    isDisabled={isLoading}
                    onPress={handleStartStream}>
                    Iniciar transmisión
                  </Button>
                )}
              </div>
            </ModalHeader>

            <ModalBody className="h-full overflow-y-auto px-3 py-3">
              {!myStream ? (
                <StreamQualityControls
                  resolution={selectedResolution}
                  fps={selectedFps}
                  onResolutionChange={setSelectedResolution}
                  onFpsChange={setSelectedFps}
                  disabled={isLoading}
                />
              ) : null}

              {error ? (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                  {error}
                </div>
              ) : null}

              {isLoading ? (
                <div className="flex items-center gap-2 text-default-500">
                  <Spinner size="sm" color="primary" />
                  <span className="text-sm">Procesando...</span>
                </div>
              ) : null}

              {previewEnabled && myStream ? (
                <div className="space-y-2 rounded-lg border border-default-200/70 bg-background/70 p-2">
                  <p className="text-[11px] font-medium text-default-600">Previsualizacion local (host)</p>
                  <div className="overflow-hidden rounded-md border border-default-200/60 bg-black/80">
                    <video
                      ref={previewVideoRef}
                      className="h-52 w-full object-contain"
                      autoPlay
                      playsInline
                      controls
                      muted
                    />
                  </div>
                </div>
              ) : null}

              {!sortedStreams.length ? (
                <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-default-200/70 bg-default-50/30 px-4 py-6 text-center text-default-500">
                  <Video className="h-5 w-5" />
                  <p className="text-sm">No hay transmisiones activas en tu cloud.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedStreams.map((stream) => {
                    const isMine = stream.hostUserId === localUserId;
                    return (
                      <div
                        key={stream.streamId}
                        className="rounded-lg border border-default-200/80 bg-default-50/35 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-foreground">{stream.hostUserId}</p>
                            <p className="truncate text-[11px] text-default-500">
                              {stream.qualityPreset} · {stream.hasSystemAudio ? "audio sistema" : "sin audio"}
                              {stream.hasMicAudio ? " + mic" : ""} · {stream.viewerCount}/{stream.maxViewers} viewers
                            </p>
                          </div>

                          {isMine ? (
                            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              Tu transmisión
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="flat"
                              color="primary"
                              isDisabled={stream.viewerCount >= stream.maxViewers}
                              onPress={() => handleJoinStream(stream.streamId, stream.hostUserId)}>
                              {stream.viewerCount >= stream.maxViewers ? "Lleno" : "Ver"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ModalBody>
          </div>
        )}
      </ModalContent>
    </Modal>
  );
}
