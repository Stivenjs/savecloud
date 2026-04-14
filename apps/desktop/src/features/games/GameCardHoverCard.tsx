import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type HlsType from "hls.js";
import { motion } from "framer-motion";
import { Button, Chip, Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import { ImageIcon, Maximize2, Video, Volume2, VolumeX } from "lucide-react";
import type { Swiper as SwiperType } from "swiper";
import { Autoplay, EffectFade } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { GameVideoModal } from "@features/games/GameVideoModal";

import "swiper/css";
import "swiper/css/effect-fade";

const isHlsUrl = (url: string) => url.includes(".m3u8");

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
}

/**
 * Envuelve la tarjeta de juego y muestra un popover al hacer hover
 * con más información e imágenes (estilo Steam).
 */
export function GameCardHoverCard({ children, mediaUrls, videoUrl, genres = [], storeName }: GameCardHoverCardProps) {
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

      const Hls = (await import("hls.js")).default;

      if (!isMounted) return;

      if (Hls.isSupported()) {
        hlsRef.current?.destroy();

        const hls = new Hls();
        hlsRef.current = hls;

        hls.loadSource(videoUrl);
        hls.attachMedia(videoEl);

        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) hls.destroy();
        });
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
        offset={8}
        classNames={{
          content: "max-w-[20rem] w-[20rem] p-0 overflow-hidden rounded-xl shadow-lg border border-default-200/80",
        }}>
        <PopoverTrigger>
          <div className="outline-none" onMouseEnter={openHovercard} onMouseLeave={closeHovercard}>
            {children}
          </div>
        </PopoverTrigger>

        <PopoverContent
          onMouseEnter={openHovercard}
          onMouseLeave={closeHovercard}
          className="p-0 overflow-hidden rounded-xl border-0 shadow-lg bg-transparent">
          <motion.div
            className="relative w-full overflow-hidden bg-default-200"
            variants={contentVariants}
            initial="hidden"
            animate="visible">
            <div className="relative h-44 w-full">
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
                      hasCarousel
                        ? {
                            delay: CAROUSEL_INTERVAL_MS,
                            disableOnInteraction: false,
                            pauseOnMouseEnter: false,
                          }
                        : false
                    }>
                    {validUrls.map((url) => (
                      <SwiperSlide key={url} className="flex! h-44 items-stretch justify-center bg-default-200">
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
                <div className="h-44 w-full bg-default-200" />
              ) : null}

              {isVideoMode && hasVideo ? (
                <video
                  ref={videoRef}
                  src={useHls ? undefined : videoUrl!}
                  className="absolute inset-0 z-5 h-full w-full object-cover object-center"
                  muted
                  loop
                  playsInline
                  preload="metadata"
                />
              ) : null}
            </div>

            {hasVideo && (
              <div className="absolute right-1.5 top-1.5 z-20 flex gap-1">
                {isVideoMode && (
                  <>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      className="min-w-8 w-8 h-8 rounded-lg bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                      aria-label="Ver vídeo en grande"
                      onPress={() => setShowVideoModal(true)}>
                      <Maximize2 size={16} strokeWidth={2} />
                    </Button>

                    <Button
                      isIconOnly
                      size="sm"
                      variant="flat"
                      className="min-w-8 w-8 h-8 rounded-lg bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                      aria-label={isMuted ? "Activar sonido" : "Silenciar"}
                      onPress={() => setIsMuted((m) => !m)}>
                      {isMuted ? <VolumeX size={16} strokeWidth={2} /> : <Volume2 size={16} strokeWidth={2} />}
                    </Button>
                  </>
                )}

                <Button
                  isIconOnly
                  size="sm"
                  variant="flat"
                  className="min-w-8 w-8 h-8 rounded-lg bg-black/50 text-white backdrop-blur-sm hover:bg-black/70"
                  aria-label={isVideoMode ? "Ver imágenes" : "Reproducir vídeo"}
                  onPress={toggleVideoMode}>
                  {isVideoMode ? <ImageIcon size={16} strokeWidth={2} /> : <Video size={16} strokeWidth={2} />}
                </Button>
              </div>
            )}
          </motion.div>

          {(storeName?.trim() || genres.length > 0) && (
            <div className="relative z-10 w-full border-t border-default-200/80 bg-default-100 px-2.5 py-2 dark:bg-default-50">
              {storeName?.trim() ? (
                <p className="line-clamp-2 text-xs font-semibold leading-tight text-foreground">{storeName.trim()}</p>
              ) : null}
              {genres.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {genres.slice(0, 5).map((g, i) => (
                    <Chip
                      key={`${g}-${i}`}
                      size="sm"
                      variant="flat"
                      color="default"
                      className="h-5 max-w-36 truncate text-[10px]">
                      {g}
                    </Chip>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {hasVideo && videoUrl && (
        <GameVideoModal isOpen={showVideoModal} onClose={() => setShowVideoModal(false)} videoUrl={videoUrl} />
      )}
    </>
  );
}
