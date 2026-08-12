/**
 * @module StreamingSocket
 * @description Orquestador y capa de transporte unificada para el streaming de video y audio en tiempo real.
 *
 * Selecciona e inicializa de forma fluida el mejor protocolo de transporte disponible:
 * 1. **WebTransport (HTTP/3 QUIC UDP Datagrams)**: Cero bloqueo de cabecera (*Head-of-Line Blocking*), ideal para Wi-Fi o WAN.
 * 2. **WebSocket (WSS TCP)**: Protocolo de respaldo confiable para red local o cuando UDP está bloqueado por firewall.
 */

import type { StreamingCodec } from "./streamingTypes";
import type { WebAudioPlayerInstance } from "./WebAudioPlayer";
import type { VideoDecoderInstance } from "./VideoStreamDecoder";
import { createWebTransportSocket, isWebTransportSupported, WebTransportSocketInstance } from "./WebTransportSocket";

/** Número máximo de reintentos de reconexión antes de reportar error. */
const MAX_RETRIES = 20;

/** Intervalo entre reintentos de reconexión (ms). */
const RETRY_INTERVAL_MS = 1500;

/** Tipo de transporte de red activo. */
export type StreamingTransportType = "webtransport" | "websocket";

/**
 * Instancia del socket de streaming unificado.
 */
export interface StreamingSocketInstance {
  /** Tipo de transporte de red activo actualmente ("webtransport" | "websocket"). */
  transportType: StreamingTransportType;
  /** Cierra la conexión de transporte y libera recursos. */
  destroy: () => void;
}

/**
 * Opciones de configuración para el socket de streaming unificado.
 */
export interface StreamingSocketOptions {
  /** Puerto del servidor WebSocket local (Rust TCP). */
  wsPort: number;
  /** Puerto opcional del servidor WebTransport local (Rust UDP). */
  webTransportPort?: number;
  /** Huella digital SHA-256 opcional del certificado TLS para WebTransport. */
  certHash?: string;
  /** Instancia del reproductor de audio WebAudio (opcional). */
  audioPlayer?: WebAudioPlayerInstance;
  /** Instancia del decodificador de video WebCodecs. */
  videoDecoder: VideoDecoderInstance;
  /** Callback invocado cuando ocurre un error irrecuperable. */
  onError: (message: string) => void;
  /** Callback invocado al conectarse exitosamente notificando el protocolo activo. */
  onConnected: (transportType: StreamingTransportType) => void;
  /** Callback invocado cuando la recepción de cuadros de video se congela o reanuda. */
  onStalled?: (isStalled: boolean) => void;
  /** Callback para obtener el texto de error de reconexión (i18n). */
  getReconnectErrorMessage: () => string;
}

/**
 * Crea una nueva instancia del socket de streaming unificado.
 * Intenta establecer primero una conexión WebTransport sobre UDP.
 * Si falla o no está disponible, realiza un fallback transparente a WebSocket sobre TCP.
 *
 * @param {StreamingSocketOptions} options Configuración del socket (puertos, decodificadores, callbacks).
 * @returns {StreamingSocketInstance} Instancia con tipo de transporte activo y método `destroy`.
 */
export function createStreamingSocket(options: StreamingSocketOptions): StreamingSocketInstance {
  const {
    wsPort,
    webTransportPort,
    certHash,
    audioPlayer,
    videoDecoder,
    onError,
    onConnected,
    onStalled,
    getReconnectErrorMessage,
  } = options;

  let activeTransport: { destroy: () => void } | null = null;
  let activeType: StreamingTransportType = "websocket";
  let ws: WebSocket | null = null;
  let retryCount = 0;
  let isDestroyed = false;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastVideoFrameTime = Date.now();
  let isStalledState = false;
  let stallCheckInterval: ReturnType<typeof setInterval> | null = null;

  /** Limpia la conexión WebSocket de respaldo si existe. */
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

  /** Programa un reintento de reconexión WebSocket con backoff fijo. */
  const scheduleReconnect = (): void => {
    if (isDestroyed) return;

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.log(`[StreamingSocket] Reintentando conexión WebSocket (${retryCount}/${MAX_RETRIES})...`);
      reconnectTimeout = setTimeout(() => {
        if (!isDestroyed) connectWebSocket();
      }, RETRY_INTERVAL_MS);
    } else {
      onError(getReconnectErrorMessage());
    }
  };

  /** Inicia la conexión WebSocket TCP de respaldo. */
  const connectWebSocket = (): void => {
    if (isDestroyed) return;
    cleanupWs();

    try {
      ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        if (isDestroyed) return;
        console.log("[StreamingSocket] Conectado al servidor de streaming mediante WebSocket TCP");
        activeType = "websocket";
        retryCount = 0;
        lastVideoFrameTime = Date.now();
        onConnected("websocket");

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
        console.log("[StreamingSocket] Conexión WebSocket cerrada");
        if (isStalledState) {
          isStalledState = false;
          onStalled?.(false);
        }
        scheduleReconnect();
      };

      ws.onerror = (e) => {
        if (isDestroyed) return;
        console.warn("[StreamingSocket] Error de WebSocket TCP (esperando transmisión):", e);
      };
    } catch (e: any) {
      if (!isDestroyed) {
        onError(`Init error: ${e.message}`);
      }
    }
  };

  /** Intenta primero conectar vía WebTransport QUIC (UDP), con fallback a WebSocket. */
  const initTransport = async () => {
    if (webTransportPort && isWebTransportSupported()) {
      try {
        console.log("[StreamingSocket] Intentando conectar transporte primario: WebTransport HTTP/3 (UDP)...");
        const wtSocket: WebTransportSocketInstance = await createWebTransportSocket({
          port: webTransportPort,
          certHash,
          audioPlayer,
          videoDecoder,
          onConnected: () => {
            if (!isDestroyed) {
              activeType = "webtransport";
              onConnected("webtransport");
            }
          },
          onError: (msg) => {
            console.warn("[StreamingSocket] Error en WebTransport, ejecutando fallback a WebSocket TCP:", msg);
            if (!isDestroyed) connectWebSocket();
          },
          onStalled,
        });

        if (isDestroyed) {
          wtSocket.destroy();
          return;
        }

        activeTransport = wtSocket;
        activeType = "webtransport";
        return;
      } catch (err) {
        console.warn("[StreamingSocket] Fallo al iniciar WebTransport UDP, utilizando fallback a WebSocket TCP:", err);
      }
    }

    // Fallback directo a WebSocket
    connectWebSocket();
  };

  initTransport();

  /** Destruye el socket de transporte y libera recursos. */
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
    if (activeTransport) {
      activeTransport.destroy();
      activeTransport = null;
    }
    cleanupWs();
  };

  return {
    get transportType() {
      return activeType;
    },
    destroy,
  };
}
