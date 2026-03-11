import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Hls from "hls.js";
import { AnimatePresence, motion } from "framer-motion";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { ImageIcon, Maximize2, Video, Volume2, VolumeX } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { GameVideoModal } from "@features/games/GameVideoModal";

const isHlsUrl = (url: string) => url.includes(".m3u8");

const HOVER_OPEN_DELAY_MS = 400;
const HOVER_CLOSE_DELAY_MS = 150;
const CAROUSEL_INTERVAL_MS = 3500;

/** Transición del carrusel: slide + fade (easeIn en exit, easeOut en enter = easeInOut global). */
const slideVariants = {
  enter: {
    x: 32,
    opacity: 0,
    transition: { duration: 0.28, ease: "easeOut" as const },
  },
  center: {
    x: 0,
    opacity: 1,
    transition: { duration: 0.28, ease: "easeOut" as const },
  },
  exit: {
    x: -32,
    opacity: 0,
    transition: { duration: 0.22, ease: "easeIn" as const },
  },
};

/** Entrada suave del contenido del popover. */
const contentVariants = {
  hidden: { opacity: 0, scale: 0.98 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.2, ease: "easeOut" as const },
  },
};

export interface GameCardHoverCardProps {
  game: ConfiguredGame;
  /** Contenido que activa el hovercard (la tarjeta). */
  children: ReactNode;
  /** URLs de medios para el carrusel (portada, capturas, thumbnails de vídeos). */
  mediaUrls: string[];
  /** URL del vídeo (HLS .m3u8, DASH .mpd o webm) del juego si existe; muestra icono para alternar vídeo / slider. */
  videoUrl?: string | null;
  /** Estadísticas para mostrar en el hovercard. Opcional. */
  stats?: GameStats | null;
}

/**
 * Envuelve la tarjeta de juego y muestra un popover al hacer hover
 * con más información e imágenes (estilo Steam).
 */
export function GameCardHoverCard({
  children,
  mediaUrls,
  videoUrl,
}: GameCardHoverCardProps) {
  const [showHovercard, setShowHovercard] = useState(false);
  const [isVideoMode, setIsVideoMode] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentImageLoaded, setCurrentImageLoaded] = useState(false);
  const [nextImageReady, setNextImageReady] = useState(false);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());
  const hoverOpenRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextSlideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const pendingAdvanceRef = useRef(false);
  const preloadImgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const hasVideo = Boolean(videoUrl?.trim());
  const useHls = hasVideo && videoUrl != null && isHlsUrl(videoUrl);

  const validUrls = mediaUrls.filter((url) => !failedUrls.has(url));
  const hasCarousel = validUrls.length > 1;
  const safeIndex = validUrls.length ? currentIndex % validUrls.length : 0;
  const currentUrl = validUrls[safeIndex];
  const nextUrl = hasCarousel
    ? validUrls[(safeIndex + 1) % validUrls.length]
    : null;

  useEffect(() => {
    setCurrentImageLoaded(false);
    setNextImageReady(false);
  }, [currentUrl]);

  useEffect(() => {
    if (showHovercard) {
      setCurrentIndex(0);
    } else {
      setIsVideoMode(false);
      setIsMuted(true);
      videoRef.current?.pause();
      hlsRef.current?.destroy();
      hlsRef.current = null;
    }
  }, [showHovercard]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (!isVideoMode || !hasVideo || !videoUrl || !useHls) return;
    const videoEl = videoRef.current;
    if (!videoEl) return;
    if (Hls.isSupported()) {
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(videoUrl);
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) hls.destroy();
      });
      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }
    if (videoEl.canPlayType("application/vnd.apple.mpegurl")) {
      videoEl.src = videoUrl;
    }
  }, [isVideoMode, hasVideo, videoUrl, useHls]);

  useEffect(() => {
    if (!showHovercard || !nextUrl) return;
    setNextImageReady(false);
    const img = new Image();
    preloadImgRef.current = img;
    img.onload = () => {
      if (preloadImgRef.current !== img) return;
      setNextImageReady(true);
      if (pendingAdvanceRef.current) {
        pendingAdvanceRef.current = false;
        setCurrentIndex((i) => (i + 1) % validUrls.length);
      }
    };
    img.onerror = () => {
      if (preloadImgRef.current !== img) return;
      setNextImageReady(true);
    };
    img.src = nextUrl;
    return () => {
      preloadImgRef.current = null;
      img.src = "";
    };
  }, [showHovercard, nextUrl, validUrls.length]);

  useEffect(() => {
    if (!showHovercard || !hasCarousel || !currentImageLoaded || isVideoMode)
      return;
    nextSlideTimeoutRef.current = setTimeout(() => {
      nextSlideTimeoutRef.current = null;
      if (nextImageReady) {
        setCurrentIndex((i) => (i + 1) % validUrls.length);
      } else {
        pendingAdvanceRef.current = true;
      }
    }, CAROUSEL_INTERVAL_MS);
    return () => {
      if (nextSlideTimeoutRef.current) {
        clearTimeout(nextSlideTimeoutRef.current);
        nextSlideTimeoutRef.current = null;
      }
    };
  }, [
    showHovercard,
    hasCarousel,
    currentImageLoaded,
    nextImageReady,
    validUrls.length,
    isVideoMode,
  ]);

  const toggleVideoMode = useCallback(() => {
    if (isVideoMode) {
      videoRef.current?.pause();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      setIsVideoMode(false);
    } else {
      setIsVideoMode(true);
      setTimeout(() => videoRef.current?.play(), 150);
    }
  }, [isVideoMode]);

  const reportImageError = useCallback((url: string) => {
    setFailedUrls((prev) => new Set(prev).add(url));
  }, []);

  const openHovercard = useCallback(() => {
    if (hoverCloseRef.current) {
      clearTimeout(hoverCloseRef.current);
      hoverCloseRef.current = null;
    }
    if (hoverOpenRef.current) return;
    hoverOpenRef.current = setTimeout(() => {
      hoverOpenRef.current = null;
      setShowHovercard(true);
    }, HOVER_OPEN_DELAY_MS);
  }, []);

  const closeHovercard = useCallback(() => {
    if (hoverOpenRef.current) {
      clearTimeout(hoverOpenRef.current);
      hoverOpenRef.current = null;
    }
    if (hoverCloseRef.current) return;
    hoverCloseRef.current = setTimeout(() => {
      hoverCloseRef.current = null;
      setShowHovercard(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, []);

  return (
    <>
      <Popover
        isOpen={showHovercard}
        placement="right"
        showArrow
        offset={8}
        classNames={{
          content:
            "max-w-[20rem] w-[20rem] p-0 overflow-hidden rounded-xl shadow-lg border border-default-200/80",
        }}
      >
        <PopoverTrigger>
          <div
            className="outline-none"
            onMouseEnter={openHovercard}
            onMouseLeave={closeHovercard}
          >
            {children}
          </div>
        </PopoverTrigger>
        <PopoverContent
          onMouseEnter={openHovercard}
          onMouseLeave={closeHovercard}
          className="p-0 overflow-hidden rounded-xl border-0 shadow-lg bg-transparent"
        >
          <motion.div
            className="relative w-full h-44 overflow-hidden rounded-xl bg-default-200"
            variants={contentVariants}
            initial="hidden"
            animate="visible"
          >
            {isVideoMode && hasVideo ? (
              <video
                ref={videoRef}
                src={useHls ? undefined : videoUrl!}
                className="absolute inset-0 size-full object-cover object-center"
                muted
                loop
                playsInline
                preload="metadata"
              />
            ) : validUrls.length > 0 ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.img
                  key={currentUrl}
                  src={currentUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover object-center"
                  variants={slideVariants}
                  initial="enter"
                  animate={currentImageLoaded ? "center" : "enter"}
                  exit="exit"
                  onLoad={() => setCurrentImageLoaded(true)}
                  onError={() => reportImageError(currentUrl)}
                />
              </AnimatePresence>
            ) : (
              <div className="absolute inset-0 bg-default-200" />
            )}
            {hasVideo && (
              <div className="absolute right-1.5 top-1.5 z-10 flex gap-1">
                {isVideoMode && (
                  <>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      className="min-w-8 w-8 h-8 rounded-lg bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                      aria-label="Ver vídeo en grande"
                      onPress={() => setShowVideoModal(true)}
                    >
                      <Maximize2 size={16} strokeWidth={2} />
                    </Button>
                    <Button
                    isIconOnly
                    size="sm"
                    variant="flat"
                    className="min-w-8 w-8 h-8 rounded-lg bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                    aria-label={isMuted ? "Activar sonido" : "Silenciar"}
                    onPress={() => setIsMuted((m) => !m)}
                  >
                    {isMuted ? (
                      <VolumeX size={16} strokeWidth={2} />
                    ) : (
                      <Volume2 size={16} strokeWidth={2} />
                    )}
                  </Button>
                </>
              )}
              <Button
                isIconOnly
                size="sm"
                variant="flat"
                className="min-w-8 w-8 h-8 rounded-lg bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                aria-label={isVideoMode ? "Ver imágenes" : "Reproducir vídeo"}
                onPress={toggleVideoMode}
              >
                {isVideoMode ? (
                  <ImageIcon size={16} strokeWidth={2} />
                ) : (
                  <Video size={16} strokeWidth={2} />
                )}
              </Button>
            </div>
          )}
        </motion.div>
      </PopoverContent>
      </Popover>
      {hasVideo && videoUrl && (
        <GameVideoModal
          isOpen={showVideoModal}
          onClose={() => setShowVideoModal(false)}
          videoUrl={videoUrl}
        />
      )}
    </>
  );
}
