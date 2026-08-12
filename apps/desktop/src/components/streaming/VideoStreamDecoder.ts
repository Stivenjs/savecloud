/**
 * @module VideoStreamDecoder
 * @description Decodificador de video multicódec (H.264, H.265/HEVC, AV1) mediante WebCodecs API.
 *
 * Recibe tramas de video codificadas (Annex B) del WebSocket,
 * las decodifica usando aceleración por hardware (GPU) y renderiza
 * cada fotograma en un HTMLCanvasElement.
 *
 * Incluye corrección dinámica de metadatos NAL (sobrescritura de visibleRect) para evitar
 * recortes cuando la GPU entrega resoluciones codificadas con alineación de macrobloques.
 *
 * Optimizado para baja latencia en streaming de juegos remotos.
 */

import { getSavedStreamingConfig, StreamingCodec } from "./streamingTypes";

/**
 * Instancia del decodificador de video.
 * Expone métodos para procesar tramas, reconfigurar el códec, verificar estado y liberar recursos.
 */
export interface VideoDecoderInstance {
  /** Procesa una trama de video codificada recibida del WebSocket. */
  processVideoFrame: (buffer: ArrayBuffer, msgType: number) => void;
  /** Reconfigura dinámicamente el decodificador WebCodecs cuando el backend reporta un cambio de códec. */
  setCodec: (codec: StreamingCodec) => void;
  /** Libera los recursos del VideoDecoder. */
  destroy: () => void;
}

/**
 * Opciones de configuración para el decodificador de video.
 */
export interface VideoDecoderOptions {
  /** Elemento canvas donde se renderizan los fotogramas. */
  canvas: HTMLCanvasElement;
  /** Contexto 2D del canvas. */
  ctx: CanvasRenderingContext2D;
  /** Callback invocado cuando ocurre un error de decodificación. */
  onError: (message: string) => void;
  /** Códec de video preferido ('h264' | 'h265' | 'av1'). Si no se especifica, se lee de localStorage */
  codec?: StreamingCodec;
}

/**
 * Mapeo de identificadores de códec de SaveCloud a cadenas MIME estrictas de WebCodecs.
 */
const CODEC_STRINGS: Record<StreamingCodec, string[]> = {
  h265: ["hev1.1.6.L150.90", "hev1.1.6.L120.90", "hvc1.1.6.L150.90", "hev1.1.6.L93.90"],
  av1: ["av01.0.08M.08", "av01.0.04M.08"],
  h264: ["avc1.4d002a", "avc1.42E01E", "avc1.64002A"],
};

/**
 * Comprueba el soporte de aceleración por hardware para los códecs de video en la GPU cliente.
 *
 * @param {StreamingCodec} [preferredCodec="h265"] Códec preferido por el usuario ('h265' | 'av1' | 'h264')
 * @returns {Promise<StreamingCodec>} El mejor códec soportado por hardware en el cliente
 */
export async function getBestSupportedCodec(preferredCodec: StreamingCodec = "h265"): Promise<StreamingCodec> {
  if (typeof VideoDecoder === "undefined") return "h264";

  const testCodec = async (codecStr: string): Promise<boolean> => {
    try {
      const res = await VideoDecoder.isConfigSupported({
        codec: codecStr,
        hardwareAcceleration: "prefer-hardware",
      });
      return !!res.supported;
    } catch {
      return false;
    }
  };

  if (preferredCodec === "h265") {
    for (const str of CODEC_STRINGS.h265) {
      if (await testCodec(str)) return "h265";
    }
  } else if (preferredCodec === "av1") {
    for (const str of CODEC_STRINGS.av1) {
      if (await testCodec(str)) return "av1";
    }
  }

  return "h264";
}

/**
 * Configura WebCodecs VideoDecoder buscando la primera cadena de códec compatible con la GPU local.
 *
 * @param {VideoDecoder} decoder Instancia de VideoDecoder
 * @param {StreamingCodec} targetCodec Códec de la sesión (h264, h265, av1)
 * @returns {string} Cadena MIME configurada exitosamente
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
 * Calcula de forma 100% dinámica las dimensiones visibles reales de un fotograma,
 * ajustando automáticamente los márgenes de alineación por macrobloques (16x16) de la GPU.
 *
 * @param {VideoFrame} frame Fotograma decodificado recibido de WebCodecs
 * @returns {{ width: number, height: number }} Dimensiones reales del área de video activa
 */
function calculateDynamicDimensions(frame: VideoFrame): { width: number; height: number } {
  const width = frame.codedWidth && frame.codedWidth > 0 ? frame.codedWidth : frame.displayWidth || 1920;

  let height: number;
  if (frame.codedHeight && frame.codedHeight > 0) {
    // Si la altura codificada incluye padding de alineación de macrobloques (ej. 1088 = 1080 + 8)
    if (frame.codedHeight % 16 === 8) {
      height = frame.codedHeight - 8;
    } else if (frame.displayHeight && frame.displayHeight > 0 && frame.codedHeight - frame.displayHeight <= 16) {
      height = frame.displayHeight;
    } else {
      height = frame.codedHeight;
    }
  } else {
    height = frame.displayHeight || 1080;
  }

  return { width, height };
}

/**
 * Inspecciona los metadatos del fotograma decodificado y, de ser necesario, genera un wrapper
 * de VideoFrame con la región visible (visibleRect) corregida dinámicamente de borde a borde.
 *
 * @param {VideoFrame} frame Fotograma decodificado original
 * @returns {{ renderFrame: VideoFrame; isCloned: boolean }} Objeto renderizable y bandera de clonación para liberar memoria
 */
function getCorrectedVideoFrame(frame: VideoFrame): { renderFrame: VideoFrame; isCloned: boolean } {
  if (frame.codedWidth && frame.displayWidth && frame.codedWidth > frame.displayWidth) {
    const { width, height } = calculateDynamicDimensions(frame);
    try {
      const renderFrame = new VideoFrame(frame, {
        visibleRect: {
          x: 0,
          y: 0,
          width,
          height,
        },
      });
      return { renderFrame, isCloned: true };
    } catch (e) {
      console.warn("[VideoDecoder] No se pudo sobrescribir visibleRect dinámico:", e);
    }
  }
  return { renderFrame: frame, isCloned: false };
}

/**
 * Crea una nueva instancia del decodificador de video multicódec con WebCodecs API.
 *
 * @param {VideoDecoderOptions} options Configuración del decodificador (canvas, contexto 2D, callback de error, códec).
 * @returns {VideoDecoderInstance} Instancia con métodos para procesar, reconfigurar y destruir el decodificador.
 */
export function createVideoStreamDecoder(options: VideoDecoderOptions): VideoDecoderInstance {
  const { canvas, ctx, onError } = options;
  const savedConfig = getSavedStreamingConfig();

  let activeCodec: StreamingCodec = options.codec ?? savedConfig.codec;
  let frameCount = 0;
  let hasReceivedKeyFrame = false;
  let isDestroyed = false;

  const decoder = new VideoDecoder({
    output: (frame: VideoFrame) => {
      if (isDestroyed) {
        frame.close();
        return;
      }

      frameCount++;

      const { renderFrame, isCloned } = getCorrectedVideoFrame(frame);
      const { width: dynamicW, height: dynamicH } = calculateDynamicDimensions(frame);

      // Sincronización 1-a-1 de la resolución del canvas con el layout físico de la ventana o el fotograma dinámico
      const targetW = canvas.clientWidth && canvas.clientWidth > 0 ? canvas.clientWidth : dynamicW;
      const targetH = canvas.clientHeight && canvas.clientHeight > 0 ? canvas.clientHeight : dynamicH;

      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(renderFrame, 0, 0, canvas.width, canvas.height);

      if (isCloned) {
        renderFrame.close();
      }
      frame.close();
    },
    error: (e) => {
      if (isDestroyed) return;
      console.error("[VideoDecoder] Error en WebCodecs VideoDecoder:", e);
      onError(`Error de decodificación WebCodecs (${activeCodec.toUpperCase()}): ${e.message}`);
    },
  });

  let configuredCodecStr = configureDecoderWithFallback(decoder, activeCodec);

  /**
   * Reconfigura dinámicamente el decodificador WebCodecs cuando el servidor notifica el códec negociado.
   *
   * @param {StreamingCodec} newCodec Nuevo códec negociado por Rust ('h264' | 'h265' | 'av1')
   */
  const setCodec = (newCodec: StreamingCodec): void => {
    if (isDestroyed || activeCodec === newCodec) return;

    console.log(`[VideoDecoder] Reconfigurando decodificador WebCodecs de ${activeCodec} a ${newCodec}`);
    activeCodec = newCodec;
    hasReceivedKeyFrame = false;

    try {
      configuredCodecStr = configureDecoderWithFallback(decoder, newCodec);
    } catch (e) {
      console.error(`[VideoDecoder] Error al reconfigurar códec a ${newCodec}:`, e);
    }
  };

  /**
   * Procesa una trama de video codificada recibida del WebSocket.
   * El byte de encabezado (msgType) indica si es un KeyFrame (1) o Delta (0).
   *
   * @param {ArrayBuffer} buffer ArrayBuffer completo del mensaje WebSocket.
   * @param {number} msgType Tipo de mensaje: 1 = KeyFrame IDR, 0 = Delta frame.
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

    try {
      const chunk = new EncodedVideoChunk({
        timestamp: performance.now() * 1000,
        type: isKeyFrame ? "key" : "delta",
        data: data,
      });

      decoder.decode(chunk);
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

  return { processVideoFrame, setCodec, destroy };
}
