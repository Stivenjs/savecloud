import { useEffect, useRef, useState } from "react";
import { Card } from "@heroui/react";
import { useTranslation } from "react-i18next";

interface VideoPlayerProps {
  wsPort: number;
}

export const VideoPlayer = ({ wsPort }: VideoPlayerProps) => {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError(t("remotePlay.canvasContextError"));
      return;
    }

    let isUnmounted = false;
    let ws: WebSocket | null = null;
    let decoder: VideoDecoder | null = null;
    let frameCount = 0;

    const initDecoder = () => {
      decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
          if (isUnmounted) {
            frame.close();
            return;
          }
          if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
          }

          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
          frame.close();
        },
        error: (e) => {
          if (isUnmounted) return;
          console.error("VideoDecoder error:", e);
          setError(`Decoder Error: ${e.message}`);
        },
      });

      decoder.configure({
        codec: "avc1.4d002a",
        hardwareAcceleration: "prefer-hardware",
        optimizeForLatency: true,
      });
    };

    const connectWs = () => {
      ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (isUnmounted) return;
        console.log("Video WS Connected");
        setError(null);
      };

      ws.onmessage = (event) => {
        if (isUnmounted) return;
        if (!decoder || decoder.state !== "configured") return;

        const buffer = event.data;
        if (buffer.byteLength <= 1) return;

        const view = new DataView(buffer);
        const isKeyFrame = view.getUint8(0) === 1;
        const data = new Uint8Array(buffer, 1);

        try {
          const chunk = new EncodedVideoChunk({
            timestamp: performance.now() * 1000,
            type: isKeyFrame ? "key" : "delta",
            data: data,
          });

          decoder.decode(chunk);
          frameCount++;
        } catch (e) {
          console.error("Decode chunk error:", e);
        }
      };

      ws.onclose = () => {
        if (isUnmounted) return;
        console.log("Video WS Closed");
      };

      ws.onerror = (e) => {
        if (isUnmounted) return;
        console.error("Video WS Error:", e);
        setError(t("remotePlay.wsVideoError"));
      };
    };

    try {
      initDecoder();
      connectWs();
    } catch (e: any) {
      if (!isUnmounted) {
        setError(`Init error: ${e.message}`);
      }
    }

    return () => {
      isUnmounted = true;
      if (ws) {
        ws.close();
      }
      if (decoder && decoder.state !== "closed") {
        decoder.close();
      }
    };
  }, [wsPort, t]);

  return (
    <Card className="w-full h-full bg-black flex items-center justify-center overflow-hidden border-none rounded-none absolute inset-0 z-50">
      {error && <div className="absolute top-4 left-4 bg-red-500/80 text-white px-4 py-2 rounded">{error}</div>}
      <canvas ref={canvasRef} className="w-full h-full object-contain" />
    </Card>
  );
};
