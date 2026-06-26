import type Hls from "hls.js";
import type { HlsConfig } from "hls.js";

export type { default as HlsType } from "hls.js";

let hlsClassPromise: Promise<typeof Hls | null> | null = null;

/**
 * Precarga de forma asíncrona la librería hls.js en segundo plano.
 * Esto elimina el retraso de carga/importación al abrir o reproducir videos.
 */
export function preloadHls(): void {
  if (!hlsClassPromise) {
    hlsClassPromise = import("hls.js")
      .then((m) => m.default)
      .catch((err) => {
        console.error("Error al precargar hls.js:", err);
        hlsClassPromise = null;
        return null;
      });
  }
}

export const isHlsUrl = (url: string): boolean => {
  return typeof url === "string" && url.includes(".m3u8");
};

export interface InitHlsOptions {
  videoEl: HTMLVideoElement;
  videoUrl: string;
  config?: Partial<HlsConfig>;
  onManifestParsed?: () => void;
  onError?: (errorData: any) => void;
}

// Configuración centralizada optimizada para arranque rápido (Fast Startup) sin perder calidad de vídeo
const DEFAULT_HLS_CONFIG: Partial<HlsConfig> = {
  // Comienza a precargar el primer fragmento de video de forma anticipada antes de presionar play
  startFragPrefetch: true,
  // Habilita workers web para decodificar/analizar en segundo plano de manera fluida sin bloquear el hilo principal
  enableWorker: true,
  // Evita interrupciones en huecos de buffer muy pequeños (ej. desajustes de milisegundos en frames de audio/video)
  maxBufferHole: 0.5,
  // Monitoriza fallos en el buffer de reproducción y se recupera rápidamente ante bloqueos de red
  highBufferWatchdogPeriod: 2,
};

/**
 * Carga e inicializa centralmente una instancia de HLS.
 * Utiliza caché de la promesa de importación para resolución instantánea.
 */
export async function initHls({
  videoEl,
  videoUrl,
  config = {},
  onManifestParsed,
  onError,
}: InitHlsOptions): Promise<Hls | null> {
  try {
    preloadHls();

    const HlsClass = await hlsClassPromise;

    if (!HlsClass || !HlsClass.isSupported()) {
      return null;
    }

    const hlsInstance = new HlsClass({
      ...DEFAULT_HLS_CONFIG,
      ...config,
    });

    hlsInstance.loadSource(videoUrl);
    hlsInstance.attachMedia(videoEl);

    if (onManifestParsed) {
      hlsInstance.on(HlsClass.Events.MANIFEST_PARSED, onManifestParsed);
    }

    hlsInstance.on(HlsClass.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        hlsInstance.destroy();
      }
      if (onError) {
        onError(data);
      }
    });

    return hlsInstance;
  } catch (error) {
    console.error("Error al inicializar la instancia Hls:", error);
    if (onError) {
      onError(error);
    }
    return null;
  }
}
