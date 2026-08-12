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
import { Card, Chip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, Cpu } from "lucide-react";
import { createVideoStreamDecoder, VideoDecoderInstance } from "./VideoStreamDecoder";
import { createStreamingSocket, StreamingSocketInstance } from "./StreamingSocket";
import { createVideoRenderer, VideoRenderer, VideoRendererBackend } from "./VideoRenderer";

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
  const [activeBackend, setActiveBackend] = useState<VideoRendererBackend | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let isCancelled = false;
    let videoDecoder: VideoDecoderInstance | null = null;
    let streamingSocket: StreamingSocketInstance | null = null;
    let renderer: VideoRenderer | null = null;

    const initStreaming = async () => {
      try {
        renderer = await createVideoRenderer(canvas);
        if (isCancelled) {
          renderer.destroy();
          return;
        }

        setActiveBackend(renderer.backend);

        videoDecoder = createVideoStreamDecoder({
          canvas,
          renderer,
          onError: (msg) => {
            if (!isCancelled) setError(msg);
          },
        });

        streamingSocket = createStreamingSocket({
          wsPort,
          videoDecoder,
          onError: (msg) => {
            if (!isCancelled) setError(msg);
          },
          onConnected: () => {
            if (!isCancelled) setError(null);
          },
          onStalled: (stalled) => {
            if (!isCancelled) setIsStalled(stalled);
          },
          getReconnectErrorMessage: () => tRef.current("remotePlay.wsVideoError"),
        });
      } catch (err: any) {
        if (!isCancelled) {
          console.error("[VideoPlayer] Error al inicializar el sistema de renderizado:", err);
          setError(err?.message || tRef.current("remotePlay.canvasContextError"));
        }
      }
    };

    initStreaming();

    return () => {
      isCancelled = true;
      streamingSocket?.destroy();
      videoDecoder?.destroy();
      renderer?.destroy();
    };
  }, [wsPort]);

  return (
    <Card
      className="w-full h-full bg-black flex items-center justify-center overflow-hidden border-none rounded-none absolute inset-0 z-50 select-none"
      style={{ backgroundColor: "#000000" }}>
      {error && <div className="absolute top-4 left-4 bg-red-500/80 text-white px-4 py-2 rounded z-50">{error}</div>}

      {activeBackend && (
        <div className="absolute top-4 right-4 z-50 pointer-events-none opacity-80 hover:opacity-100 transition-opacity">
          <Chip
            size="sm"
            variant="flat"
            color={
              activeBackend === "webgpu" ? ("emerald" as any) : activeBackend === "webgl2" ? "secondary" : "warning"
            }
            startContent={<Cpu size={12} className="ml-1" />}
            className="text-[10px] font-semibold tracking-wide uppercase bg-black/60 backdrop-blur-md border border-white/10 text-white shadow-lg">
            {activeBackend === "webgpu"
              ? "WebGPU 0-Copy VRAM"
              : activeBackend === "webgl2"
                ? "WebGL2 GPU"
                : "Canvas 2D"}
          </Chip>
        </div>
      )}

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
        className="w-full h-full block cursor-none bg-black"
        style={{ width: "100%", height: "100%", backgroundColor: "#000000" }}
      />
    </Card>
  );
};
