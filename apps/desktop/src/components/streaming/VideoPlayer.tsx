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
import { ShieldAlert } from "lucide-react";
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
  const [isStalled, setIsStalled] = useState(false);

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
      onStalled: (stalled) => setIsStalled(stalled),
      getReconnectErrorMessage: () => tRef.current("remotePlay.wsVideoError"),
    });

    return () => {
      streamingSocket.destroy();
      videoDecoder.destroy();
    };
  }, [wsPort]);

  return (
    <Card
      className="w-full h-full bg-black flex items-center justify-center overflow-hidden border-none rounded-none absolute inset-0 z-50 select-none"
      style={{ backgroundColor: "#000000" }}>
      {error && <div className="absolute top-4 left-4 bg-red-500/80 text-white px-4 py-2 rounded z-50">{error}</div>}

      {isStalled && (
        <div className="absolute top-6 inset-x-0 flex justify-center z-50 pointer-events-none px-4">
          <div className="bg-amber-950/90 border border-amber-500/40 text-amber-200 px-4 py-2 rounded-xl shadow-2xl backdrop-blur-md text-xs font-medium flex items-center gap-2.5 animate-pulse max-w-xl text-center">
            <ShieldAlert size={18} className="text-amber-400 shrink-0" />
            <span>{t("remotePlay.uacNotice")}</span>
          </div>
        </div>
      )}

      <canvas
        ref={canvasRef}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full h-full object-contain cursor-none bg-black"
        style={{ backgroundColor: "#000000" }}
      />
    </Card>
  );
};
