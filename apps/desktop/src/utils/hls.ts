import type Hls from "hls.js";
import type { HlsConfig } from "hls.js";

export type { default as HlsType } from "hls.js";

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

/**
 * Carga e inicializa centralmente una instancia de HLS.
 * Se utilizan importaciones dinámicas para evitar incluir hls.js en el paquete inicial principal.
 */
export async function initHls({
  videoEl,
  videoUrl,
  config = {},
  onManifestParsed,
  onError,
}: InitHlsOptions): Promise<Hls | null> {
  try {
    const HlsClass = (await import("hls.js")).default;

    if (!HlsClass.isSupported()) {
      return null;
    }

    const hlsInstance = new HlsClass({
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
    console.error("Error initializing Hls instance:", error);
    if (onError) {
      onError(error);
    }
    return null;
  }
}
