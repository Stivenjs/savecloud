import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { initHls, isHlsUrl } from "@utils/hls";
import type { HlsType } from "@utils/hls";
import { motion } from "framer-motion";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { ImageIcon, Maximize2, Video, Volume2, VolumeX } from "lucide-react";
import type { Swiper as SwiperType } from "swiper";
import { Autoplay, EffectFade } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { GameVideoModal } from "@features/games/GameVideoModal";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";
import { formatGameDisplayName } from "@utils/gameImage";

import "swiper/css";
import "swiper/css/effect-fade";

const HOVER_OPEN_DELAY_MS = 400;
const HOVER_CLOSE_DELAY_MS = 150;
const CAROUSEL_INTERVAL_MS = 3500;

const VIDEO_INIT_DELAY_MS = 700;

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
  /** Géneros desde la misma petición Store que los medios. */
  genres?: string[];
  /** Nombre en tienda Steam (opcional; refuerzo junto al título local). */
  storeName?: string | null;
  /** Estadísticas para mostrar en el hovercard. Opcional. */
  stats?: GameStats | null;
  /** Tipo de tarjeta: biblioteca o catálogo */
  variant?: "library" | "catalog";
}

/**
 * Envuelve la tarjeta de juego y muestra un popover al hacer hover
 * con más información e imágenes (estilo Steam).
 */
export function GameCardHoverCard({
  game,
  children,
  mediaUrls,
  videoUrl,
  genres = [],
  storeName,
  variant = "library",
}: GameCardHoverCardProps) {
  const isLowPerf = useLowPerformanceMode();

  const [showHovercard, setShowHovercard] = useState(false);
  const [isVideoMode, setIsVideoMode] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());

  const hoverOpenRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoInitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const swiperRef = useRef<SwiperType | null>(null);

  const isHoveringRef = useRef(false);

  const hlsRef = useRef<HlsType | null>(null);

  const hasVideo = Boolean(videoUrl?.trim());
  const useHls = hasVideo && videoUrl != null && isHlsUrl(videoUrl);

  const validUrls = mediaUrls.filter((url) => !failedUrls.has(url));
  const hasCarousel = validUrls.length > 1;

  /** Destruye la instancia HLS activa de forma segura y limpia la referencia. */
  const destroyHls = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  /** Pausa el video y destruye HLS. Evita llamar play() en un elemento desmontado. */
  const stopVideo = useCallback(() => {
    videoRef.current?.pause();
    destroyHls();
  }, [destroyHls]);

  useEffect(() => {
    if (!showHovercard) {
      setIsVideoMode(false);
      setIsMuted(true);

      stopVideo();

      if (videoInitTimeoutRef.current) {
        clearTimeout(videoInitTimeoutRef.current);
        videoInitTimeoutRef.current = null;
      }
    }
  }, [showHovercard, stopVideo]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted;
  }, [isMuted]);

  useEffect(() => {
    if (!isVideoMode || !hasVideo || !videoUrl || !useHls) return;

    const videoEl = videoRef.current;
    if (!videoEl) return;

    let isMounted = true;

    videoInitTimeoutRef.current = setTimeout(async () => {
      if (!isMounted) return;

      const hlsInstance = await initHls({
        videoEl,
        videoUrl,
        onError: (data) => {
          if (data.fatal && isMounted) {
            hlsRef.current = null;
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
        videoEl.src = videoUrl;
      }
    }, VIDEO_INIT_DELAY_MS);

    return () => {
      isMounted = false;

      if (videoInitTimeoutRef.current) {
        clearTimeout(videoInitTimeoutRef.current);
        videoInitTimeoutRef.current = null;
      }

      destroyHls();
    };
  }, [isVideoMode, hasVideo, videoUrl, useHls, destroyHls]);

  /** No desmontar Swiper al reproducir vídeo: evita slides/crossfade corruptos al volver a imágenes. */
  useEffect(() => {
    const swiper = swiperRef.current;
    if (!swiper?.autoplay) return;
    if (isVideoMode) {
      swiper.autoplay.stop();
    } else if (hasCarousel && showHovercard) {
      void swiper.autoplay.start();
    }
  }, [isVideoMode, hasCarousel, showHovercard]);

  const toggleVideoMode = useCallback(() => {
    if (isVideoMode) {
      stopVideo();
      setIsVideoMode(false);
    } else {
      setIsVideoMode(true);

      requestAnimationFrame(() => {
        videoRef.current?.play();
      });
    }
  }, [isVideoMode, stopVideo]);

  const reportImageError = useCallback((url: string) => {
    setFailedUrls((prev) => new Set(prev).add(url));
  }, []);

  const openHovercard = useCallback(() => {
    isHoveringRef.current = true;

    if (hoverCloseRef.current) {
      clearTimeout(hoverCloseRef.current);
      hoverCloseRef.current = null;
    }

    if (hoverOpenRef.current) return;

    hoverOpenRef.current = setTimeout(() => {
      if (!isHoveringRef.current) return;

      hoverOpenRef.current = null;
      setShowHovercard(true);
    }, HOVER_OPEN_DELAY_MS);
  }, []);

  const closeHovercard = useCallback(() => {
    isHoveringRef.current = false;

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
        offset={12}
        isNonModal={true}
        classNames={{
          content:
            "max-w-[20rem] w-[20rem] p-0 overflow-hidden rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-zinc-800/80 bg-[#0e0f14]/98 backdrop-blur-md",
        }}>
        <PopoverTrigger>
          <div className="outline-none" onMouseEnter={openHovercard} onMouseLeave={closeHovercard}>
            {children}
          </div>
        </PopoverTrigger>

        <PopoverContent
          onMouseEnter={openHovercard}
          onMouseLeave={closeHovercard}
          className="p-0 overflow-hidden rounded-2xl border-0 shadow-none bg-transparent">
          <motion.div
            className="relative w-full overflow-hidden bg-zinc-950/45 rounded-t-2xl"
            variants={contentVariants}
            initial="hidden"
            animate="visible">
            <div className="relative h-44 w-full overflow-hidden rounded-t-2xl">
              {validUrls.length > 0 ? (
                <div
                  className={
                    isVideoMode && hasVideo
                      ? "pointer-events-none invisible absolute inset-0 z-0 opacity-0"
                      : "absolute inset-0 z-0"
                  }
                  aria-hidden={isVideoMode && hasVideo}>
                  <Swiper
                    key={`${showHovercard}-${validUrls.join("|")}`}
                    modules={[Autoplay, EffectFade]}
                    onSwiper={(instance) => {
                      swiperRef.current = instance;
                    }}
                    effect="coverflow"
                    fadeEffect={{ crossFade: true }}
                    speed={480}
                    slidesPerView={1}
                    loop={hasCarousel}
                    allowTouchMove={hasCarousel}
                    className="h-full w-full [&_.swiper-slide]:h-44 [&_.swiper-wrapper]:h-full"
                    autoplay={
                      hasCarousel && !isLowPerf
                        ? {
                            delay: CAROUSEL_INTERVAL_MS,
                            disableOnInteraction: false,
                            pauseOnMouseEnter: false,
                          }
                        : false
                    }>
                    {validUrls.map((url) => (
                      <SwiperSlide key={url} className="flex! h-44 items-stretch justify-center bg-zinc-950">
                        <img
                          src={url}
                          alt="Game image"
                          className="h-full w-full object-cover object-center"
                          loading="lazy"
                          onError={() => reportImageError(url)}
                        />
                      </SwiperSlide>
                    ))}
                  </Swiper>
                </div>
              ) : null}

              {validUrls.length === 0 && !(isVideoMode && hasVideo) ? (
                <div className="h-44 w-full bg-zinc-950" />
              ) : null}

              {isVideoMode && hasVideo ? (
                <video
                  ref={videoRef}
                  src={useHls ? undefined : videoUrl!}
                  className="absolute inset-0 z-5 h-full w-full object-cover object-center bg-zinc-950"
                  muted
                  loop
                  playsInline
                  preload="metadata"
                />
              ) : null}
            </div>

            {hasVideo && (
              <div className="absolute right-2 top-2 z-20 flex gap-1.5">
                {isVideoMode && (
                  <>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      className="min-w-8 w-8 h-8 rounded-full bg-zinc-950/70 text-white border border-white/5 backdrop-blur-md hover:bg-zinc-900/90"
                      aria-label="Ver vídeo en grande"
                      onPress={() => setShowVideoModal(true)}>
                      <Maximize2 size={14} strokeWidth={2} />
                    </Button>

                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      className="min-w-8 w-8 h-8 rounded-full bg-zinc-950/70 text-white border border-white/5 backdrop-blur-md hover:bg-zinc-900/90"
                      aria-label={isMuted ? "Activar sonido" : "Silenciar"}
                      onPress={() => setIsMuted((m) => !m)}>
                      {isMuted ? <VolumeX size={14} strokeWidth={2} /> : <Volume2 size={14} strokeWidth={2} />}
                    </Button>
                  </>
                )}

                <Button
                  isIconOnly
                  size="sm"
                  variant="flat"
                  className="min-w-8 w-8 h-8 rounded-full bg-zinc-950/70 text-white border border-white/5 backdrop-blur-md hover:bg-zinc-900/90"
                  aria-label={isVideoMode ? "Ver imágenes" : "Reproducir vídeo"}
                  onPress={toggleVideoMode}>
                  {isVideoMode ? <ImageIcon size={14} strokeWidth={2} /> : <Video size={14} strokeWidth={2} />}
                </Button>
              </div>
            )}
          </motion.div>

          <div className="relative z-10 w-full border-t border-zinc-800/50 bg-[#13151b]/98 px-4 py-3 rounded-b-2xl">
            <p className="line-clamp-2 text-xs font-bold text-white tracking-tight leading-snug mb-1.5">
              {variant === "catalog"
                ? storeName?.trim() || formatGameDisplayName(game.id)
                : formatGameDisplayName(game.id)}
            </p>
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {genres.slice(0, 5).map((g, i) => (
                  <span
                    key={`${g}-${i}`}
                    className="text-[9px] font-medium px-2 py-0.5 rounded-md bg-zinc-800/40 border border-zinc-700/20 text-zinc-400 truncate tracking-wide">
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {hasVideo && videoUrl && (
        <GameVideoModal isOpen={showVideoModal} onClose={() => setShowVideoModal(false)} videoUrl={videoUrl} />
      )}
    </>
  );
}
