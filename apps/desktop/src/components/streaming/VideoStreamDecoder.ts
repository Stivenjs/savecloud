/**
 * @module VideoStreamDecoder
 * @description Decodificador de video H.264 en tiempo real mediante WebCodecs API.
 *
 * Recibe tramas de video codificadas (H.264 Annex B) del WebSocket,
 * las decodifica usando aceleración por hardware (GPU) y renderiza
 * cada fotograma en un HTMLCanvasElement.
 *
 * Optimizado para baja latencia en streaming de juegos remotos.
 */

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
}

/**
 * Crea una nueva instancia del decodificador de video H.264 con WebCodecs.
 *
 * @param options - Configuración del decodificador (canvas, contexto 2D, callback de error).
 * @returns {VideoDecoderInstance} Instancia con métodos para procesar y destruir el decodificador.
 *
 * @example
 * ```ts
 * const videoDecoder = createVideoStreamDecoder({
 *   canvas: canvasElement,
 *   ctx: canvasElement.getContext("2d")!,
 *   onError: (msg) => console.error(msg),
 * });
 *
 * // En el onmessage del WebSocket:
 * videoDecoder.processVideoFrame(buffer, msgType);
 *
 * // Al desmontar:
 * videoDecoder.destroy();
 * ```
 */
export function createVideoStreamDecoder(options: VideoDecoderOptions): VideoDecoderInstance {
  const { canvas, ctx, onError } = options;

  let frameCount = 0;
  let hasReceivedKeyFrame = false;
  let isDestroyed = false;

  const decoder = new VideoDecoder({
    output: (frame: VideoFrame) => {
      if (isDestroyed) {
        frame.close();
        return;
      }

      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        console.log("[VideoDecoder] Canvas redimensionado:", frame.displayWidth, "x", frame.displayHeight);
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }

      ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      frame.close();
    },
    error: (e) => {
      if (isDestroyed) return;
      console.error("[VideoDecoder] Error:", e);
      onError(`Decoder Error: ${e.message}`);
    },
  });

  decoder.configure({
    codec: "avc1.4d002a",
    hardwareAcceleration: "prefer-hardware",
    optimizeForLatency: true,
  });

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
      console.log("[VideoDecoder] Primer KeyFrame recibido. Iniciando decodificación.");
    }

    if (frameCount < 10 || isKeyFrame) {
      console.log(`[VideoDecoder] Trama #${frameCount} (bytes: ${data.byteLength}, keyframe: ${isKeyFrame})`);
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
