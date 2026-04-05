import { useEffect, useRef, useCallback, useMemo } from "react";
import type HlsType from "hls.js";

const isHlsUrl = (url: string) => url.includes(".m3u8");

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

  // Cleanup HLS on unmount or URL change
  useEffect(() => {
    return () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      isInitializedRef.current = false;
    };
  }, [videoUrl]);

  // Initialize HLS when needed - solo corre una vez por URL
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
        const Hls = (await import("hls.js")).default;

        if (!isMounted) return;

        if (Hls.isSupported()) {
          // Destroy previous instance if exists
          hlsRef.current?.destroy();

          const hls = new Hls({
            maxBufferLength: 30,
            maxMaxBufferLength: 60,
          });
          hlsRef.current = hls;
          hls.loadSource(videoUrl);
          hls.attachMedia(videoEl);

          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            onReady?.();
            if (autoPlay && videoEl.paused) {
              videoEl.play().catch(() => {});
            }
          });

          hls.on(Hls.Events.ERROR, (_, data) => {
            if (data.fatal) {
              hls.destroy();
              hlsRef.current = null;
              onError?.();
            }
          });
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
    // Solo depende de videoUrl y useHls, NO de autoPlay
  }, [videoUrl, useHls]);

  // Handle direct video playback (non-HLS) - solo corre una vez por URL
  useEffect(() => {
    if (!useHls && videoRef.current && videoUrl && !isInitializedRef.current) {
      isInitializedRef.current = true;
      videoRef.current.src = videoUrl;
      onReady?.();
      if (autoPlay && videoRef.current.paused) {
        videoRef.current.play().catch(() => {});
      }
    }
    // Solo depende de videoUrl y useHls, NO de autoPlay
  }, [videoUrl, useHls]);

  // Controlar play/pause basado en autoPlay sin reinicializar
  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !isInitializedRef.current) return;

    if (autoPlay && videoEl.paused) {
      videoEl.play().catch(() => {});
    } else if (!autoPlay && !videoEl.paused) {
      videoEl.pause();
    }
  }, [autoPlay]);

  // Track play state changes
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
      controls
      preload={preload}
      onPlay={handlePlay}
      onPause={handlePause}
      onError={handleError}
    />
  );
}
