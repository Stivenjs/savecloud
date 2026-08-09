/**
 * @module WebAudioPlayer
 * @description Motor de reproducción de audio PCM en tiempo real mediante WebAudio API.
 *
 * Recibe tramas PCM de 16-bit a 48kHz stereo desde el backend Rust vía WebSocket,
 * las acumula en un buffer de cola para garantizar bloques mínimos de 20ms,
 * y las programa secuencialmente en el AudioContext del navegador.
 *
 * Diseñado para baja latencia en streaming de juegos remotos (Moonlight/Sunshine).
 */

/** Tamaño mínimo de bloque de audio: 960 muestras estéreo (20ms a 48kHz). */
const MIN_BLOCK_SAMPLES = 960;

/** Frecuencia de muestreo del stream PCM de Moonlight. */
const SAMPLE_RATE = 48000;

/** Margen de programación para evitar clics por underflow (en segundos). */
const SCHEDULING_MARGIN = 0.01;

/**
 * Instancia del reproductor de audio WebAudio.
 * Mantiene el estado interno del AudioContext, la cola de muestras
 * y la línea de tiempo de programación.
 */
export interface WebAudioPlayerInstance {
  /** Procesa un mensaje binario del WebSocket que contiene audio PCM. */
  processAudioMessage: (buffer: ArrayBuffer) => void;
  /** Libera todos los recursos del AudioContext. */
  destroy: () => void;
  /** Reanuda el AudioContext (necesario tras interacción del usuario por política de autoplay). */
  resume: () => void;
}

/**
 * Crea una nueva instancia del reproductor de audio WebAudio.
 *
 * @returns {WebAudioPlayerInstance} Instancia con métodos para procesar, destruir y reanudar audio.
 *
 * @example
 * ```ts
 * const player = createWebAudioPlayer();
 *
 * ws.onmessage = (event) => {
 *   const view = new DataView(event.data);
 *   if (view.getUint8(0) === 2) {
 *     player.processAudioMessage(event.data);
 *   }
 * };
 *
 * // Al hacer clic en el canvas para reanudar autoplay
 * canvas.addEventListener("click", () => player.resume());
 *
 * // Al desmontar el componente
 * player.destroy();
 * ```
 */
export function createWebAudioPlayer(): WebAudioPlayerInstance {
  let audioCtx: AudioContext | null = null;
  let nextScheduledTime = 0;
  let blockCount = 0;
  const sampleQueue: number[] = [];

  /**
   * Obtiene o inicializa el AudioContext del navegador.
   * Si está suspendido por política de autoplay, intenta reanudarlo.
   */
  const getOrCreateContext = (): AudioContext => {
    if (!audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      audioCtx = new AudioCtxClass({
        sampleRate: SAMPLE_RATE,
        latencyHint: "interactive",
      });
    }

    if (audioCtx.state === "suspended") {
      audioCtx.resume().then(() => {
        console.log("[WebAudioPlayer] AudioContext reanudado exitosamente");
      });
    }

    return audioCtx;
  };

  /**
   * Programa la reproducción de un bloque de muestras estéreo en el AudioContext.
   * Separa las muestras intercaladas (L R L R ...) en canales independientes.
   *
   * @param samples - Array de muestras float32 intercaladas (L, R, L, R, ...).
   */
  const scheduleAudioBlock = (samples: number[]): void => {
    const ctx = getOrCreateContext();
    const framesPerChannel = samples.length / 2;

    const audioBuffer = ctx.createBuffer(2, framesPerChannel, SAMPLE_RATE);
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = audioBuffer.getChannelData(1);

    for (let i = 0; i < framesPerChannel; i++) {
      leftChannel[i] = samples[i * 2];
      rightChannel[i] = samples[i * 2 + 1];
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const currentTime = ctx.currentTime;
    if (nextScheduledTime < currentTime) {
      nextScheduledTime = currentTime + SCHEDULING_MARGIN;
    }

    source.start(nextScheduledTime);
    nextScheduledTime += audioBuffer.duration;
  };

  /**
   * Procesa un mensaje binario del WebSocket que contiene audio PCM.
   * El primer byte (encabezado de tipo = 2) ya fue verificado por el llamador.
   * Los bytes restantes son muestras PCM de 16-bit intercaladas (L, R, L, R, ...).
   *
   * Las muestras se acumulan en una cola interna y se emiten en bloques
   * de 960 muestras (20ms) para evitar micro-cortes y mantener baja latencia.
   *
   * @param buffer - ArrayBuffer completo del mensaje WebSocket (incluye byte de encabezado).
   */
  const processAudioMessage = (buffer: ArrayBuffer): void => {
    try {
      const pcmData = buffer.slice(1);
      const pcm16 = new Int16Array(pcmData);
      if (pcm16.length === 0) return;

      for (let i = 0; i < pcm16.length; i++) {
        sampleQueue.push(pcm16[i] / 32768.0);
      }

      while (sampleQueue.length >= MIN_BLOCK_SAMPLES) {
        const block = sampleQueue.splice(0, MIN_BLOCK_SAMPLES);
        scheduleAudioBlock(block);

        blockCount++;
        if (blockCount <= 5 || blockCount % 200 === 0) {
          console.log(`[WebAudioPlayer] Bloque #${blockCount} reproducido (${block.length / 2} muestras por canal)`);
        }
      }
    } catch (e) {
      console.error("[WebAudioPlayer] Error al procesar trama de audio:", e);
    }
  };

  /** Reanuda el AudioContext tras interacción del usuario (política de autoplay de Chromium). */
  const resume = (): void => {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  };

  /** Libera todos los recursos del AudioContext y vacía la cola de muestras. */
  const destroy = (): void => {
    sampleQueue.length = 0;
    if (audioCtx && audioCtx.state !== "closed") {
      audioCtx.close();
      audioCtx = null;
    }
  };

  return { processAudioMessage, destroy, resume };
}
