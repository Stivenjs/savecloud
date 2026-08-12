/**
 * @module StreamingSocket
 * @description Gestión del WebSocket de streaming para video y audio.
 *
 * Establece y mantiene una conexión WebSocket con el servidor local de Rust,
 * discrimina los tipos de mensaje (video, audio) y los enruta a los módulos
 * correspondientes. Implementa reconexión automática con reintentos limitados.
 *
 * Protocolo de mensajes binarios:
 * - Byte 0 = 0x00: Trama delta de video (H.264 P-frame)
 * - Byte 0 = 0x01: KeyFrame de video (H.264 IDR)
 * - Byte 0 = 0x02: Trama de audio PCM 16-bit 48kHz stereo
 */

import type { StreamingCodec } from "./streamingTypes";
import type { WebAudioPlayerInstance } from "./WebAudioPlayer";
import type { VideoDecoderInstance } from "./VideoStreamDecoder";

/** Número máximo de reintentos de reconexión antes de reportar error. */
const MAX_RETRIES = 20;

/** Intervalo entre reintentos de reconexión (ms). */
const RETRY_INTERVAL_MS = 1500;

/**
 * Instancia del socket de streaming.
 * Expone un método para destruir la conexión y liberar recursos.
 */
export interface StreamingSocketInstance {
  /** Cierra el WebSocket y cancela cualquier reconexión pendiente. */
  destroy: () => void;
}

/**
 * Opciones de configuración para el socket de streaming.
 */
export interface StreamingSocketOptions {
  /** Puerto del servidor WebSocket local (Rust). */
  wsPort: number;
  /** Instancia del reproductor de audio WebAudio (opcional). */
  audioPlayer?: WebAudioPlayerInstance;
  /** Instancia del decodificador de video WebCodecs. */
  videoDecoder: VideoDecoderInstance;
  /** Callback invocado cuando ocurre un error irrecuperable. */
  onError: (message: string) => void;
  /** Callback invocado cuando la conexión se establece exitosamente. */
  onConnected: () => void;
  /** Callback invocado cuando la recepción de cuadros de video se congela o reanuda. */
  onStalled?: (isStalled: boolean) => void;
  /** Callback para obtener el texto de error de reconexión (i18n). */
  getReconnectErrorMessage: () => string;
}

/**
 * Crea una nueva instancia del socket de streaming.
 * Establece la conexión WebSocket y enruta los mensajes binarios
 * al reproductor de audio o al decodificador de video según el tipo.
 *
 * @param {StreamingSocketOptions} options Configuración del socket (puerto, módulos, callbacks).
 * @returns {StreamingSocketInstance} Instancia con método `destroy`.
 */
export function createStreamingSocket(options: StreamingSocketOptions): StreamingSocketInstance {
  const { wsPort, audioPlayer, videoDecoder, onError, onConnected, onStalled, getReconnectErrorMessage } = options;

  let ws: WebSocket | null = null;
  let retryCount = 0;
  let isDestroyed = false;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastVideoFrameTime = Date.now();
  let isStalledState = false;
  let stallCheckInterval: ReturnType<typeof setInterval> | null = null;

  /** Limpia todos los handlers y cierra el WebSocket actual. */
  const cleanupWs = (): void => {
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      ws = null;
    }
  };

  /** Programa un reintento de reconexión con backoff fijo. */
  const scheduleReconnect = (): void => {
    if (isDestroyed) return;

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`[StreamingSocket] Reintentando conexión (${retryCount}/${MAX_RETRIES})...`);
      reconnectTimeout = setTimeout(() => {
        if (!isDestroyed) connect();
      }, RETRY_INTERVAL_MS);
    } else {
      onError(getReconnectErrorMessage());
    }
  };

  /** Establece una nueva conexión WebSocket con el servidor local. */
  const connect = (): void => {
    if (isDestroyed) return;
    cleanupWs();

    try {
      ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (isDestroyed) return;
        console.log("[StreamingSocket] Conectado al servidor de streaming");
        retryCount = 0;
        lastVideoFrameTime = Date.now();
        onConnected();

        if (stallCheckInterval) clearInterval(stallCheckInterval);
        stallCheckInterval = setInterval(() => {
          if (isDestroyed || !ws || ws.readyState !== WebSocket.OPEN) return;
          const diff = Date.now() - lastVideoFrameTime;
          if (diff > 3500 && !isStalledState) {
            isStalledState = true;
            onStalled?.(true);
          }
        }, 1000);
      };

      ws.onmessage = (event) => {
        if (isDestroyed) return;

        if (typeof event.data === "string") {
          try {
            const data = JSON.parse(event.data);
            if (data.type === "codec_init" && data.codec) {
              console.log(`[StreamingSocket] Notificación de códec negociado recibida de Rust: ${data.codec}`);
              videoDecoder.setCodec(data.codec as StreamingCodec);
            }
          } catch (e) {
            console.warn("[StreamingSocket] Error procesando mensaje de texto JSON:", e);
          }
          return;
        }

        const buffer: ArrayBuffer = event.data;
        if (!buffer || buffer.byteLength <= 1) return;

        const msgType = new DataView(buffer).getUint8(0);

        if (msgType === 2) {
          audioPlayer?.processAudioMessage(buffer);
        } else {
          lastVideoFrameTime = Date.now();
          if (isStalledState) {
            isStalledState = false;
            onStalled?.(false);
          }
          videoDecoder.processVideoFrame(buffer, msgType);
        }
      };

      ws.onclose = () => {
        if (isDestroyed) return;
        console.log("[StreamingSocket] Conexión cerrada");
        if (isStalledState) {
          isStalledState = false;
          onStalled?.(false);
        }
        scheduleReconnect();
      };

      ws.onerror = (e) => {
        if (isDestroyed) return;
        console.warn("[StreamingSocket] Error de WebSocket (esperando inicio de stream):", e);
      };
    } catch (e: any) {
      if (!isDestroyed) {
        onError(`Init error: ${e.message}`);
      }
    }
  };

  connect();

  /** Destruye la conexión y cancela cualquier reconexión pendiente. */
  const destroy = (): void => {
    isDestroyed = true;
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }
    if (stallCheckInterval) {
      clearInterval(stallCheckInterval);
      stallCheckInterval = null;
    }
    cleanupWs();
  };

  return { destroy };
}
