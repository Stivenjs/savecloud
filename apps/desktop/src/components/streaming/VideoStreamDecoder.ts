/**
 * @module VideoStreamDecoder
 * @description Decodificador de video multicódec (H.264, H.265/HEVC, AV1) mediante WebCodecs API.
 *
 * Recibe tramas de video codificadas (Annex B) del WebSocket,
 * las decodifica usando aceleración por hardware (GPU) y renderiza
 * cada fotograma en un HTMLCanvasElement.
 *
 * Optimizado para baja latencia en streaming de juegos remotos.
 */

import { getSavedStreamingConfig, StreamingCodec } from "./streamingTypes";

/**
 * Instancia del decodificador de video.
 * Expone métodos para procesar tramas, verificar estado y liberar recursos.
 */
export interface VideoDecoderInstance {
  /** Procesa una trama de video codificada recibida del WebSocket. */
  processVideoFrame: (buffer: ArrayBuffer, msgType: number) => void;
  /** Libera los recursos del VideoDecoder. */
  destroy: () => void;
}

/**
 * Opciones de configuración para el decodificador de video.
 */
export interface VideoDecoderOptions {
  /** Elemento canvas donde se renderizarán los fotogramas. */
  canvas: HTMLCanvasElement;
  /** Contexto 2D del canvas. */
  ctx: CanvasRenderingContext2D;
  /** Callback invocado cuando ocurre un error de decodificación. */
  onError: (message: string) => void;
  /** Códec de video preferido ('h264' | 'h265' | 'av1'). Si no se especifica, se lee de localStorage */
  codec?: StreamingCodec;
}

/**
 * Mapeo de identificadores de códec de SaveCloud a cadenas MIME de WebCodecs.
 */
const CODEC_STRINGS: Record<StreamingCodec, string[]> = {
  h265: ["hev1.1.6.L150.90", "hev1.1.6.L120.90", "hvc1.1.6.L150.90", "avc1.4d002a"],
  av1: ["av01.0.08M.08", "av01.0.04M.08", "avc1.4d002a"],
  h264: ["avc1.4d002a", "avc1.42E01E", "avc1.64002A"],
};

/**
 * Configura WebCodecs VideoDecoder buscando la primera cadena de códec compatible con la GPU local.
 *
 * @param decoder Instancia de VideoDecoder
 * @param targetCodec Códec de la sesión (h264, h265, av1)
 */
function configureDecoderWithFallback(decoder: VideoDecoder, targetCodec: StreamingCodec): string {
  const candidates = CODEC_STRINGS[targetCodec] ?? CODEC_STRINGS.h264;
  let selectedCodecString = candidates[0];

  for (const str of candidates) {
    try {
      decoder.configure({
        codec: str,
        hardwareAcceleration: "prefer-hardware",
        optimizeForLatency: true,
      });
      selectedCodecString = str;
      console.log(`[VideoDecoder] WebCodecs configurado exitosamente con códec: ${str} (${targetCodec})`);
      break;
    } catch (e) {
      console.warn(`[VideoDecoder] No se pudo configurar códec ${str}:`, e);
    }
  }

  return selectedCodecString;
}

/**
 * Crea una nueva instancia del decodificador de video multicódec con WebCodecs.
 *
 * @param options - Configuración del decodificador (canvas, contexto 2D, callback de error, códec).
 * @returns {VideoDecoderInstance} Instancia con métodos para procesar y destruir el decodificador.
 */
export function createVideoStreamDecoder(options: VideoDecoderOptions): VideoDecoderInstance {
  const { canvas, ctx, onError } = options;
  const savedConfig = getSavedStreamingConfig();
  const activeCodec: StreamingCodec = options.codec ?? savedConfig.codec;

  let frameCount = 0;
  let hasReceivedKeyFrame = false;
  let isDestroyed = false;

  const decoder = new VideoDecoder({
    output: (frame: VideoFrame) => {
      if (isDestroyed) {
        frame.close();
        return;
      }

      const codedW = frame.codedWidth && frame.codedWidth > 0 ? frame.codedWidth : frame.displayWidth;
      const codedH = frame.codedHeight && frame.codedHeight > 0 ? frame.codedHeight : frame.displayHeight;

      let frameToDraw: VideoFrame = frame;
      let customFrame: VideoFrame | null = null;

      if (frame.visibleRect && (frame.visibleRect.width < codedW || frame.visibleRect.height < codedH)) {
        try {
          customFrame = new VideoFrame(frame, {
            visibleRect: { x: 0, y: 0, width: codedW, height: codedH },
          });
          frameToDraw = customFrame;
        } catch (e) {
          console.warn("[VideoDecoder] No se pudo expandir visibleRect:", e);
        }
      }

      if (canvas.width !== codedW || canvas.height !== codedH) {
        console.log(
          `[VideoDecoder] Canvas dimensionado a textura completa: ${codedW}x${codedH} (original visibleRect: ${frame.visibleRect?.width}x${frame.visibleRect?.height})`
        );
        canvas.width = codedW;
        canvas.height = codedH;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(frameToDraw, 0, 0, codedW, codedH);

      if (customFrame) customFrame.close();
      frame.close();
    },
    error: (e) => {
      if (isDestroyed) return;
      console.error("[VideoDecoder] Error en WebCodecs VideoDecoder:", e);
      onError(`Error de decodificación WebCodecs (${activeCodec.toUpperCase()}): ${e.message}`);
    },
  });

  const configuredCodecStr = configureDecoderWithFallback(decoder, activeCodec);

  /**
   * Procesa una trama de video codificada recibida del WebSocket.
   * El byte de encabezado (msgType) indica si es un KeyFrame (1) o Delta (0).
   *
   * @param buffer - ArrayBuffer completo del mensaje WebSocket.
   * @param msgType - Tipo de mensaje: 1 = KeyFrame IDR, 0 = Delta frame.
   */
  const processVideoFrame = (buffer: ArrayBuffer, msgType: number): void => {
    if (isDestroyed || decoder.state !== "configured") return;

    const isKeyFrame = msgType === 1;
    const data = new Uint8Array(buffer, 1);

    if (!hasReceivedKeyFrame) {
      if (!isKeyFrame) return;
      hasReceivedKeyFrame = true;
      console.log(
        `[VideoDecoder] Primer KeyFrame IDR recibido. Decodificando con ${configuredCodecStr} (${activeCodec}).`
      );
    }

    if (frameCount < 10 || isKeyFrame) {
      console.log(
        `[VideoDecoder] Trama #${frameCount} (${data.byteLength} bytes, keyframe: ${isKeyFrame}, codec: ${activeCodec})`
      );
    }

    try {
      const chunk = new EncodedVideoChunk({
        timestamp: performance.now() * 1000,
        type: isKeyFrame ? "key" : "delta",
        data: data,
      });

      decoder.decode(chunk);
      frameCount++;
    } catch (e) {
      console.error("[VideoDecoder] Error al decodificar chunk:", e);
    }
  };

  /** Libera los recursos del VideoDecoder. */
  const destroy = (): void => {
    isDestroyed = true;
    if (decoder.state !== "closed") {
      decoder.close();
    }
  };

  return { processVideoFrame, destroy };
}
