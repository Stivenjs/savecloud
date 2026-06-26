import { useEffect, useRef, useCallback, useMemo } from "react";
import { initHls, isHlsUrl } from "@utils/hls";
import type { HlsType } from "@utils/hls";

export interface VideoPlayerProps {
  /** URL del vídeo (HLS .m3u8 o directa). */
  videoUrl: string;
  /** Reproducir automáticamente al montar. */
  autoPlay?: boolean;
  /** Iniciar en silencio. */
  muted?: boolean;
  /** Loop del vídeo. */
  loop?: boolean;
  /** Clases CSS adicionales para el contenedor. */
  className?: string;
  /** Callback cuando el vídeo está listo para reproducirse. */
  onReady?: () => void;
  /** Callback cuando hay un error en el vídeo. */
  onError?: () => void;
  /** Callback cuando cambia el estado de reproducción. */
  onPlayStateChange?: (isPlaying: boolean) => void;
  /** Prioridad de precarga. */
  preload?: "auto" | "metadata" | "none";
}

/**
 * Componente de reproductor de video reutilizable.
 * Soporta HLS (.m3u8) y videos directos (mp4, webm, etc.).
 * Basado en la implementación de GameVideoModal para mantener consistencia.
 */
export function VideoPlayer({
  videoUrl,
  autoPlay = true,
  muted = true,
  loop = true,
  className = "",
  onReady,
  onError,
  onPlayStateChange,
  preload = "auto",
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<HlsType | null>(null);
  const isInitializedRef = useRef(false);

  const useHls = useMemo(() => videoUrl != null && isHlsUrl(videoUrl), [videoUrl]);

  useEffect(() => {
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      isInitializedRef.current = false;
    };
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl || !useHls || isInitializedRef.current) {
      return;
    }

    const videoEl = videoRef.current;
    if (!videoEl) return;

    let isMounted = true;
    isInitializedRef.current = true;

    const initVideo = async () => {
      try {
        const hlsInstance = await initHls({
          videoEl,
          videoUrl,
          config: {
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
          },
          onManifestParsed: () => {
            if (isMounted) {
              onReady?.();
              if (autoPlay && videoEl.paused) {
                videoEl.play().catch(() => {});
              }
            }
          },
          onError: (data) => {
            if (data.fatal && isMounted) {
              hlsRef.current = null;
              onError?.();
            }
          },
        });

        if (!isMounted) {
          hlsInstance?.destroy();
          return;
        }

        if (hlsInstance) {
          hlsRef.current?.destroy();
          hlsRef.current = hlsInstance;
        } else if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
          // Native HLS support (Safari)
          videoEl.src = videoUrl;
          onReady?.();
        }
      } catch {
        onError?.();
      }
    };

    initVideo();

    return () => {
      isMounted = false;
    };
  }, [videoUrl, useHls]);

  useEffect(() => {
    if (!useHls && videoRef.current && videoUrl && !isInitializedRef.current) {
      isInitializedRef.current = true;
      videoRef.current.src = videoUrl;
      onReady?.();
      if (autoPlay && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
    }
  }, [videoUrl, useHls]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !isInitializedRef.current) return;

    if (autoPlay && videoEl.paused) {
      videoEl.play().catch(() => {});
    } else if (!autoPlay && !videoEl.paused) {
      videoEl.pause();
    }
  }, [autoPlay]);

  const handlePlay = useCallback(() => {
    onPlayStateChange?.(true);
  }, [onPlayStateChange]);

  const handlePause = useCallback(() => {
    onPlayStateChange?.(false);
  }, [onPlayStateChange]);

  const handleError = useCallback(() => {
    onError?.();
  }, [onError]);

  return (
    <video
      ref={videoRef}
      className={`size-full object-cover object-center ${className}`}
      muted={muted}
      loop={loop}
      playsInline
      controlsList="nofullscreen"
      controls
      preload={preload}
      onPlay={handlePlay}
      onPause={handlePause}
      onError={handleError}
    />
  );
}
