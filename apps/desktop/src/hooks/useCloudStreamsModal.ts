import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useDraggable } from "@heroui/react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
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
import type { StreamFpsPreset, StreamResolutionPreset } from "@features/friends/StreamQualityControls";
import { visibilityManager } from "@hooks/useAppVisibility";

// EXPERIMENTAL: orchestrates stream creation/join flow for the prototype modal.

const MAX_VIEWERS = 4;
const RESOLUTION_MAP: Record<StreamResolutionPreset, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
};

interface UseCloudStreamsModalParams {
  isOpen: boolean;
  onClose: () => void;
  modalRef: React.RefObject<HTMLElement>;
}

export function useCloudStreamsModal({ isOpen, onClose, modalRef }: UseCloudStreamsModalParams) {
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

  useEffect(() => {
    if (!isOpen || !localUserId) return;

    const requestStateSync = async () => {
      try {
        await sendCloudStreamSignal({
          event: "STREAM_SYNC_REQUEST",
          streamId: "sync-state",
        });
      } catch {
        // Si falla la sync request, seguimos con realtime normal.
      }
    };

    void requestStateSync();

    const interval = window.setInterval(() => {
      // No enviar sync requests cuando la app está en background.
      if (!visibilityManager.isVisible) return;
      void requestStateSync();
    }, 12000);

    return () => {
      window.clearInterval(interval);
    };
  }, [isOpen, localUserId]);

  const handleStopStream = useCallback(
    async (streamId: string, silent = false) => {
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
    },
    [removeStream, setActiveHostedStreamId]
  );

  const handleStartStream = useCallback(async () => {
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
  }, [handleStopStream, localUserId, myStream, selectedFps, selectedResolution, setActiveHostedStreamId, upsertStream]);

  const handleOpenViewer = useCallback(async (streamId: string, hostUserId: string) => {
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
  }, []);

  const handleJoinStream = useCallback(
    async (streamId: string, hostUserId: string) => {
      setError(null);
      try {
        await handleOpenViewer(streamId, hostUserId);
      } catch {
        setError("No se pudo abrir la ventana de visualización.");
      }
    },
    [handleOpenViewer]
  );

  const handleModalOpenChange = useCallback(
    (isOpenChange: boolean) => {
      if (!isOpenChange) onClose();
    },
    [onClose]
  );

  return {
    error,
    handleJoinStream,
    handleModalOpenChange,
    handleStartStream,
    handleStopStream,
    isLoading,
    localUserId,
    moveProps,
    myStream,
    previewEnabled,
    previewVideoRef,
    selectedFps,
    selectedResolution,
    setPreviewEnabled,
    setSelectedFps,
    setSelectedResolution,
    sortedStreams,
  };
}
