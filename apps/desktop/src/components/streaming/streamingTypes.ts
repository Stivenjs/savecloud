/**
 * @file streamingTypes.ts
 * @description Tipos, interfaces y constantes para la configuración del sistema de Remote Play / Streaming.
 */

/**
 * Preajustes de calidad y latencia predeterminados para la transmisión.
 */
export type StreamingPreset = "ultra_low_latency" | "balanced" | "high_fps" | "custom";

/**
 * Identificadores de resolución de pantalla soportadas.
 */
export type StreamingResolution = "720p" | "1080p" | "1440p" | "4k";

/**
 * Tasas de refresco / FPS soportados por la transmisión.
 */
export type StreamingFps = 30 | 60 | 90 | 120;

/**
 * Códecs de video soportados por el backend de Moonlight/Sunshine.
 */
export type StreamingCodec = "h264" | "h265" | "av1";

/**
 * Configuración completa de la sesión de Remote Play del cliente.
 */
export interface StreamingConfig {
  /** Preajuste seleccionado por el usuario */
  preset: StreamingPreset;
  /** Resolución de pantalla seleccionada */
  resolution: StreamingResolution;
  /** Tasa de fotogramas por segundo */
  fps: StreamingFps;
  /** Tasa de bits en Megabits por segundo (5 - 100 Mbps) */
  bitrateMbps: number;
  /** Códec de codificación de video (H.264, H.265/HEVC, AV1) */
  codec: StreamingCodec;
  /** Indica si se habilita el audio stereo remoto */
  audioEnabled: boolean;
  /** Activa optimizaciones adicionales para reducir la latencia de entrada y procesamiento */
  lowLatencyMode: boolean;
}

/**
 * Opción de resolución con sus dimensiones exactas en píxeles.
 */
export interface ResolutionOption {
  id: StreamingResolution;
  label: string;
  width: number;
  height: number;
}

/**
 * Opción de códec con descripción de ventajas técnicas.
 */
export interface CodecOption {
  id: StreamingCodec;
  label: string;
  badge: string;
  description: string;
}

/**
 * Opciones de resolución disponibles en el frontend.
 */
export const RESOLUTION_OPTIONS: Record<StreamingResolution, ResolutionOption> = {
  "720p": { id: "720p", label: "720p (HD)", width: 1280, height: 720 },
  "1080p": { id: "1080p", label: "1080p (Full HD)", width: 1920, height: 1080 },
  "1440p": { id: "1440p", label: "1440p (2K)", width: 2560, height: 1440 },
  "4k": { id: "4k", label: "4K (Ultra HD)", width: 3840, height: 2160 },
};

/**
 * Lista de códecs de video soportados con badges explicativos.
 */
export const CODEC_OPTIONS: CodecOption[] = [
  {
    id: "h265",
    label: "H.265 / HEVC",
    badge: "Recomendado",
    description: "Mayor calidad a menor tasa de bits y latencia ultra baja en GPUs modernas (NVIDIA/AMD/Intel).",
  },
  {
    id: "h264",
    label: "H.264 / AVC",
    badge: "Compatibilidad Máxima",
    description: "Soportado por prácticamente cualquier dispositivo e integrados gráficos antiguos.",
  },
  {
    id: "av1",
    label: "AV1 Main 8",
    badge: "Siguiente Gen",
    description:
      "Eficiencia extrema de datos para redes con ancho de banda limitado (requiere RTX 40 / RX 7000 / Arc).",
  },
];

/**
 * Valores por defecto de configuración de Remote Play.
 */
export const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
  preset: "ultra_low_latency",
  resolution: "1080p",
  fps: 60,
  bitrateMbps: 45,
  codec: "h265",
  audioEnabled: true,
  lowLatencyMode: true,
};

/** Clave en localStorage para guardar la configuración de Remote Play */
const LOCAL_STORAGE_KEY = "savecloud_remote_play_config";

/**
 * Recupera la configuración de streaming guardada en localStorage o devuelve los valores por defecto.
 *
 * @returns {StreamingConfig} Objeto de configuración de streaming
 */
export function getSavedStreamingConfig(): StreamingConfig {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StreamingConfig>;
      return {
        ...DEFAULT_STREAMING_CONFIG,
        ...parsed,
      };
    }
  } catch (err) {
    console.warn("No se pudo leer la configuración de streaming desde localStorage", err);
  }
  return DEFAULT_STREAMING_CONFIG;
}

/**
 * Guarda la configuración de streaming en localStorage para su persistencia entre ejecuciones.
 *
 * @param {StreamingConfig} config Configuración a guardar
 */
export function saveStreamingConfig(config: StreamingConfig): void {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn("No se pudo guardar la configuración de streaming en localStorage", err);
  }
}
