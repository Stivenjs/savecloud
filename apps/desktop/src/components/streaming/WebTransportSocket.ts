/**
 * @module WebTransportSocket
 * @description Gestión de transporte sobre HTTP/3 QUIC (UDP Datagrams) para la entrega de video de ultra-baja latencia.
 *
 * Utiliza la W3C WebTransport API para transmitir cada trama de video como un datagrama no confiable (*unreliable datagram*),
 * eliminando por completo el bloqueo de cabecera (*Head-of-Line Blocking*) característico de TCP/WebSockets en redes Wi-Fi o WAN.
 */

import type { WebAudioPlayerInstance } from "./WebAudioPlayer";
import type { VideoDecoderInstance } from "./VideoStreamDecoder";

/**
 * Instancia del socket de transporte sobre WebTransport QUIC.
 */
export interface WebTransportSocketInstance {
  /** Cierra la sesión WebTransport y libera los lectores de datagramas UDP. */
  destroy: () => void;
}

/**
 * Opciones de configuración para el socket WebTransport QUIC.
 */
export interface WebTransportSocketOptions {
  /** Puerto UDP del servidor WebTransport local de Rust. */
  port: number;
  /** Huella digital SHA-256 del certificado TLS 1.3 autofirmado (formato hexadecimal o ArrayBuffer). */
  certHash?: string | Uint8Array;
  /** Instancia del reproductor de audio WebAudio. */
  audioPlayer?: WebAudioPlayerInstance;
  /** Instancia del decodificador de video WebCodecs. */
  videoDecoder: VideoDecoderInstance;
  /** Callback invocado al conectarse exitosamente mediante QUIC UDP. */
  onConnected: () => void;
  /** Callback invocado cuando ocurre un error crítico de WebTransport. */
  onError: (message: string) => void;
  /** Callback invocado al congelarse o reanudarse el flujo de fotogramas. */
  onStalled?: (isStalled: boolean) => void;
}

/**
 * Convierte una cadena hexadecimal de huella SHA-256 en Uint8Array.
 *
 * @param {string} hex Cadena hexadecimal (ej: "a3b4...").
 * @returns {Uint8Array} Array de bytes correspondiente.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Verifica si la API WebTransport está soportada por el navegador o WebView2 actual.
 *
 * @returns {boolean} Verdadero si `window.WebTransport` existe y está habilitado.
 */
export function isWebTransportSupported(): boolean {
  return typeof (window as any).WebTransport !== "undefined";
}

/**
 * Crea e inicializa una sesión WebTransport sobre UDP/QUIC.
 *
 * @param {WebTransportSocketOptions} options Parámetros de conexión (puerto, huella TLS, callbacks).
 * @returns {Promise<WebTransportSocketInstance>} Instancia con método `destroy`.
 */
export async function createWebTransportSocket(
  options: WebTransportSocketOptions
): Promise<WebTransportSocketInstance> {
  const { port, certHash, audioPlayer, videoDecoder, onConnected, onError, onStalled } = options;

  if (!isWebTransportSupported()) {
    throw new Error("[WebTransportSocket] La API W3C WebTransport no está disponible en este navegador.");
  }

  let isDestroyed = false;
  let transport: any = null;
  let datagramReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let lastFrameTime = Date.now();
  let isStalledState = false;
  let stallCheckInterval: ReturnType<typeof setInterval> | null = null;

  try {
    const transportOptions: any = {};

    if (certHash) {
      const hashBytes = typeof certHash === "string" ? hexToBytes(certHash) : certHash;
      transportOptions.serverCertificateHashes = [
        {
          algorithm: "sha-256",
          value: hashBytes,
        },
      ];
    }

    const url = `https://127.0.0.1:${port}`;
    console.log(`[WebTransportSocket] Conectando a ${url} mediante HTTP/3 QUIC (UDP)...`);

    const WebTransportCtor = (window as any).WebTransport;
    transport = new WebTransportCtor(url, transportOptions);

    await transport.ready;
    if (isDestroyed) {
      transport.close();
      throw new Error("[WebTransportSocket] Conexión cancelada antes de estar lista.");
    }

    console.log("[WebTransportSocket] Conexión HTTP/3 QUIC (UDP Datagrams) establecida exitosamente.");
    onConnected();

    stallCheckInterval = setInterval(() => {
      if (isDestroyed) return;
      const diff = Date.now() - lastFrameTime;
      if (diff > 3500 && !isStalledState) {
        isStalledState = true;
        onStalled?.(true);
      }
    }, 1000);

    // Bucle asíncrono de lectura de datagramas UDP (Unreliable Datagrams)
    const readDatagrams = async () => {
      try {
        const reader = transport.datagrams.readable.getReader();
        datagramReader = reader;
        const pendingFrames = new Map<
          number,
          {
            msgType: number;
            totalChunks: number;
            receivedCount: number;
            chunks: (Uint8Array | null)[];
          }
        >();

        while (!isDestroyed) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value || value.byteLength < 5) continue;

          lastFrameTime = Date.now();
          if (isStalledState) {
            isStalledState = false;
            onStalled?.(false);
          }

          // Encabezado MTU de 5 bytes: [msgType, seq_hi, seq_lo, chunkIdx, totalChunks]
          const msgType = value[0];
          const seq = (value[1] << 8) | value[2];
          const chunkIdx = value[3];
          const totalChunks = value[4];
          const payloadSlice = value.subarray(5);

          if (totalChunks === 1) {
            // Caso directo de 1 solo fragmento
            const frameBuffer = new ArrayBuffer(1 + payloadSlice.byteLength);
            const view = new Uint8Array(frameBuffer);
            view[0] = msgType;
            view.set(payloadSlice, 1);

            if (msgType === 2) {
              audioPlayer?.processAudioMessage(frameBuffer);
            } else {
              videoDecoder.processVideoFrame(frameBuffer, msgType);
            }
          } else {
            // Reensamblado de fotogramas fragmentados
            let frame = pendingFrames.get(seq);
            if (!frame) {
              frame = {
                msgType,
                totalChunks,
                receivedCount: 0,
                chunks: new Array(totalChunks).fill(null),
              };
              pendingFrames.set(seq, frame);
            }

            if (chunkIdx < totalChunks && !frame.chunks[chunkIdx]) {
              frame.chunks[chunkIdx] = payloadSlice;
              frame.receivedCount++;

              if (frame.receivedCount === frame.totalChunks) {
                let totalLength = 0;
                for (let i = 0; i < totalChunks; i++) {
                  totalLength += frame.chunks[i]?.byteLength || 0;
                }

                const frameBuffer = new ArrayBuffer(1 + totalLength);
                const view = new Uint8Array(frameBuffer);
                view[0] = msgType;

                let offset = 1;
                for (let i = 0; i < totalChunks; i++) {
                  const slice = frame.chunks[i];
                  if (slice) {
                    view.set(slice, offset);
                    offset += slice.byteLength;
                  }
                }

                pendingFrames.delete(seq);

                if (msgType === 2) {
                  audioPlayer?.processAudioMessage(frameBuffer);
                } else {
                  videoDecoder.processVideoFrame(frameBuffer, msgType);
                }
              }
            }

            if (pendingFrames.size > 50) {
              const oldestKey = pendingFrames.keys().next().value;
              if (oldestKey !== undefined) pendingFrames.delete(oldestKey);
            }
          }
        }
      } catch (err) {
        if (!isDestroyed) {
          console.warn("[WebTransportSocket] Error en bucle de lectura de datagramas UDP:", err);
        }
      }
    };

    readDatagrams();

    // Detección de cierre de sesión
    transport.closed
      .then(() => {
        if (!isDestroyed) {
          console.log("[WebTransportSocket] Sesión WebTransport cerrada ordenadamente.");
        }
      })
      .catch((err: any) => {
        if (!isDestroyed) {
          console.warn("[WebTransportSocket] Sesión WebTransport cerrada con error:", err);
          onError(`Fallo de conexión WebTransport UDP: ${err?.message || "Error desconocido"}`);
        }
      });

    const destroy = (): void => {
      isDestroyed = true;
      if (stallCheckInterval) {
        clearInterval(stallCheckInterval);
        stallCheckInterval = null;
      }
      if (datagramReader) {
        try {
          datagramReader.releaseLock();
        } catch {}
      }
      if (transport) {
        try {
          transport.close();
        } catch {}
      }
    };

    return { destroy };
  } catch (err: any) {
    if (transport) {
      try {
        transport.close();
      } catch {}
    }
    throw new Error(`[WebTransportSocket] Fallo al establecer sesión QUIC: ${err?.message || err}`);
  }
}
