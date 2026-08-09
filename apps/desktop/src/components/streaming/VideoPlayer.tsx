/**
 * @module VideoPlayer
 * @description Componente React de streaming de video y audio en tiempo real.
 *
 * Orquesta los módulos WebAudioPlayer, VideoStreamDecoder y StreamingSocket
 * para renderizar video H.264 decodificado por GPU y reproducir audio PCM
 * mediante WebAudio API. Todo el procesamiento pesado está delegado a módulos
 * independientes para mantener este componente limpio y enfocado en la UI.
 */

import { useEffect, useRef, useState } from "react";
import { Card } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { createVideoStreamDecoder } from "./VideoStreamDecoder";
import { createStreamingSocket } from "./StreamingSocket";

interface VideoPlayerProps {
  wsPort: number;
}

export const VideoPlayer = ({ wsPort }: VideoPlayerProps) => {
  const { t } = useTranslation();
  const tRef = useRef(t);
  tRef.current = t;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError(tRef.current("remotePlay.canvasContextError"));
      return;
    }

    const videoDecoder = createVideoStreamDecoder({
      canvas,
      ctx,
      onError: setError,
    });

    const streamingSocket = createStreamingSocket({
      wsPort,
      videoDecoder,
      onError: setError,
      onConnected: () => setError(null),
      getReconnectErrorMessage: () => tRef.current("remotePlay.wsVideoError"),
    });

    return () => {
      streamingSocket.destroy();
      videoDecoder.destroy();
    };
  }, [wsPort]);

  return (
    <Card className="w-full h-full bg-black flex items-center justify-center overflow-hidden border-none rounded-none absolute inset-0 z-50">
      {error && <div className="absolute top-4 left-4 bg-red-500/80 text-white px-4 py-2 rounded">{error}</div>}
      <canvas ref={canvasRef} className="w-full h-full object-contain" />
    </Card>
  );
};
