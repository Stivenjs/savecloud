import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { initHls, isHlsUrl } from "@utils/hls";
import type { HlsType } from "@utils/hls";
import { Popover, PopoverContent, PopoverTrigger } from "@heroui/react";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  Gamepad2,
  HardDrive,
  ImageIcon,
  Maximize2,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { GameVideoModal } from "@features/games/GameVideoModal";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";
import { formatGameDisplayName } from "@utils/gameImage";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import { useAppVisibility } from "@hooks/useAppVisibility";
import { useTranslation } from "react-i18next";

const HOVER_OPEN_DELAY_MS = 380;
const HOVER_CLOSE_DELAY_MS = 140;
const CAROUSEL_INTERVAL_MS = 2800;
const VIDEO_INIT_DELAY_MS = 600;
const MAX_CAROUSEL_IMAGES = 6;

export interface GameCardHoverCardProps {
  game: ConfiguredGame;
  /** Contenido que activa el hovercard (la tarjeta del juego). */
  children: ReactNode;
  /** URLs de medios para el carrusel (portada, capturas, thumbnails de vídeos). */
  mediaUrls: string[];
  /** URL del vídeo (HLS .m3u8, DASH .mpd o webm) del juego si existe. */
  videoUrl?: string | null;
  /** Géneros del juego. */
  genres?: string[];
  /** Nombre en tienda Steam (opcional). */
  storeName?: string | null;
  /** Estadísticas para mostrar en el hovercard (tiempo de juego, guardados, etc.). */
  stats?: GameStats | null;
  /** Tipo de tarjeta: biblioteca o catálogo. */
  variant?: "library" | "catalog";
  /** Si el menú contextual de acciones está abierto, inhibe el hovercard */
  isContextMenuOpen?: boolean;
}

/**
 * HoverCard cinematográfico y limpio:
 * - Sin bordes delgados externos (acabado fluido y oscuro).
 * - Carrusel acelerado por GPU sin desfase de diapositivas al llegar al final.
 * - Sin librerías pesadas (cero Framer Motion, cero Swiper).
 */
export function GameCardHoverCard({
  game,
  children,
  mediaUrls,
  videoUrl,
  genres = [],
  storeName,
  stats,
  variant = "library",
  isContextMenuOpen = false,
}: GameCardHoverCardProps) {
  const { t } = useTranslation();
  const isLowPerf = useLowPerformanceMode();
  const { isVisible } = useAppVisibility();

  const [showHovercard, setShowHovercard] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isVideoMode, setIsVideoMode] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [failedUrls, setFailedUrls] = useState<Set<string>>(new Set());
  const [isMediaHovered, setIsMediaHovered] = useState(false);

  const hoverOpenRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoInitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const isHoveringRef = useRef(false);
  const hlsRef = useRef<HlsType | null>(null);
  const wasPlayingRef = useRef(false);

  const hasVideo = Boolean(videoUrl?.trim());
  const useHls = hasVideo && videoUrl != null && isHlsUrl(videoUrl);

  const carouselUrls = useMemo(() => {
    const unique = Array.from(new Set(mediaUrls.filter((url) => !failedUrls.has(url) && Boolean(url?.trim()))));
    return unique.slice(0, MAX_CAROUSEL_IMAGES);
  }, [mediaUrls, failedUrls]);

  const hasCarousel = carouselUrls.length > 1;

  useEffect(() => {
    if (currentSlide >= carouselUrls.length && carouselUrls.length > 0) {
      setCurrentSlide(0);
    }
  }, [carouselUrls.length, currentSlide]);

  // Rotación automática GPU: se desactiva por completo mientras el usuario interactúa o posa el cursor en la galería
  useEffect(() => {
    if (!showHovercard || isVideoMode || !hasCarousel || isLowPerf || isMediaHovered) return;

    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % carouselUrls.length);
    }, CAROUSEL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [showHovercard, isVideoMode, hasCarousel, isLowPerf, isMediaHovered, currentSlide, carouselUrls.length]);

  /** Destruye la instancia HLS activa de forma segura */
  const destroyHls = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
  }, []);

  /** Pausa el video y destruye HLS */
  const stopVideo = useCallback(() => {
    videoRef.current?.pause();
    destroyHls();
    wasPlayingRef.current = false;
  }, [destroyHls]);

  useEffect(() => {
    const videoEl = videoRef.current;
    if (!videoEl || !showHovercard || !isVideoMode) return;

    if (!isVisible) {
      wasPlayingRef.current = !videoEl.paused;
      if (wasPlayingRef.current) {
        videoEl.pause();
      }
    } else {
      if (wasPlayingRef.current) {
        videoEl.play().catch(() => {});
      }
    }
  }, [isVisible, showHovercard, isVideoMode]);

  useEffect(() => {
    if (!showHovercard) {
      setIsVideoMode(false);
      setIsMuted(true);
      setIsMediaHovered(false);
      setCurrentSlide(0);
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

  const toggleVideoMode = useCallback(() => {
    if (isVideoMode) {
      stopVideo();
      setIsVideoMode(false);
    } else {
      setIsVideoMode(true);
      requestAnimationFrame(() => {
        videoRef.current?.play().catch(() => {});
      });
    }
  }, [isVideoMode, stopVideo]);

  const reportImageError = useCallback((url: string) => {
    setFailedUrls((prev) => new Set(prev).add(url));
  }, []);

  useEffect(() => {
    if (isContextMenuOpen) {
      isHoveringRef.current = false;
      if (hoverOpenRef.current) {
        clearTimeout(hoverOpenRef.current);
        hoverOpenRef.current = null;
      }
      if (showHovercard) {
        setShowHovercard(false);
      }
    }
  }, [isContextMenuOpen, showHovercard]);

  const openHovercard = useCallback(() => {
    if (isContextMenuOpen) return;
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
  }, [isContextMenuOpen]);

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

  const prevSlide = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setCurrentSlide((prev) => (prev - 1 + carouselUrls.length) % carouselUrls.length);
    },
    [carouselUrls.length]
  );

  const nextSlide = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setCurrentSlide((prev) => (prev + 1) % carouselUrls.length);
    },
    [carouselUrls.length]
  );

  const displayName =
    variant === "catalog" ? storeName?.trim() || formatGameDisplayName(game.id) : formatGameDisplayName(game.id);

  const isCatalog = variant === "catalog";

  return (
    <>
      <Popover
        isOpen={showHovercard}
        placement="right-start"
        offset={14}
        isNonModal={true}
        classNames={{
          content: "p-0 overflow-visible border-0 shadow-none bg-transparent",
        }}>
        <PopoverTrigger>
          <div className="outline-none" onMouseEnter={openHovercard} onMouseLeave={closeHovercard}>
            {children}
          </div>
        </PopoverTrigger>

        <PopoverContent
          onMouseEnter={openHovercard}
          onMouseLeave={closeHovercard}
          className="p-0 overflow-visible border-0 shadow-none bg-transparent">
          {showHovercard ? (
            /* Tarjeta limpia, sin bordes delgados externos, con fondo oscuro fluido y sombra inmersiva */
            <div className="relative w-86 max-w-86 overflow-hidden rounded-2xl bg-[#0e1015] shadow-[0_25px_60px_rgba(0,0,0,0.85)] transform-gpu animate-in fade-in-0 zoom-in-95 duration-150 ease-out">
              {/* Cabecera Cinemática de Medios con pausa en hover para control manual */}
              <div
                className="group/media relative h-45 w-full overflow-hidden bg-zinc-950"
                onMouseEnter={() => setIsMediaHovered(true)}
                onMouseLeave={() => setIsMediaHovered(false)}>
                {/* Carrusel acelerado por GPU (crossfade de opacidad pura) */}
                {carouselUrls.length > 0 && !(isVideoMode && hasVideo) ? (
                  <div className="absolute inset-0 z-0">
                    {carouselUrls.map((url, idx) => {
                      const isActive = idx === currentSlide;
                      return (
                        <div
                          key={url}
                          className={`absolute inset-0 h-full w-full transform-gpu transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                            isActive
                              ? "opacity-100 scale-100 z-1 pointer-events-auto"
                              : "opacity-0 scale-[1.03] z-0 pointer-events-none"
                          }`}
                          style={{ willChange: "transform, opacity" }}>
                          <img
                            src={url}
                            alt={displayName}
                            className="h-full w-full object-cover object-center select-none"
                            loading="lazy"
                            onError={() => reportImageError(url)}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* Fallback sin imagen */}
                {carouselUrls.length === 0 && !(isVideoMode && hasVideo) ? (
                  <div className="flex h-full w-full items-center justify-center bg-zinc-950 text-zinc-700">
                    <ImageIcon size={36} strokeWidth={1.5} />
                  </div>
                ) : null}

                {/* Reproductor de Vídeo */}
                {isVideoMode && hasVideo ? (
                  <video
                    ref={videoRef}
                    src={useHls ? undefined : videoUrl!}
                    className="absolute inset-0 z-10 h-full w-full object-cover object-center bg-zinc-950 transform-gpu"
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    style={{ willChange: "transform" }}
                  />
                ) : null}

                {/* Viñeta de degradado inferior para fundir suavemente con la info */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-24 bg-linear-to-t from-[#0e1015] via-[#0e1015]/65 to-transparent" />
                {/* Viñeta superior para contraste de controles */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-14 bg-linear-to-b from-black/60 via-black/20 to-transparent" />

                {/* Flechas de navegación manual en hover */}
                {hasCarousel && !isVideoMode && (
                  <>
                    <button
                      type="button"
                      onClick={prevSlide}
                      aria-label="Anterior"
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-md opacity-0 group-hover/media:opacity-100 transition-all duration-150 hover:bg-black/80 hover:text-white active:scale-90 transform-gpu cursor-pointer">
                      <ChevronLeft size={16} strokeWidth={2.5} />
                    </button>
                    <button
                      type="button"
                      onClick={nextSlide}
                      aria-label="Siguiente"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 z-20 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white/80 backdrop-blur-md opacity-0 group-hover/media:opacity-100 transition-all duration-150 hover:bg-black/80 hover:text-white active:scale-90 transform-gpu cursor-pointer">
                      <ChevronRight size={16} strokeWidth={2.5} />
                    </button>
                  </>
                )}

                {/* Indicadores de diapositivas tipo píldoras cinemáticas (sincronizados 1:1) */}
                {hasCarousel && !isVideoMode && (
                  <div className="absolute bottom-2.5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-md">
                    {carouselUrls.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCurrentSlide(idx);
                        }}
                        aria-label={`Slide ${idx + 1}`}
                        className={`h-1.5 rounded-full transition-all duration-200 transform-gpu cursor-pointer ${
                          idx === currentSlide
                            ? "w-4 bg-white shadow-[0_0_6px_rgba(255,255,255,0.7)]"
                            : "w-1.5 bg-white/35 hover:bg-white/60"
                        }`}
                      />
                    ))}
                  </div>
                )}

                {/* Botón flotante de vídeo / Controles de reproducción */}
                {hasVideo && (
                  <div className="absolute right-2.5 top-2.5 z-30 flex items-center gap-1.5">
                    {isVideoMode ? (
                      <div className="flex items-center gap-1 rounded-full bg-black/65 p-1 backdrop-blur-xl shadow-lg">
                        <button
                          type="button"
                          onClick={() => setShowVideoModal(true)}
                          aria-label="Ver vídeo en grande"
                          className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-300 hover:text-white hover:bg-white/10 transition-colors active:scale-90 transform-gpu cursor-pointer">
                          <Maximize2 size={13} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsMuted((m) => !m)}
                          aria-label={isMuted ? "Activar sonido" : "Silenciar"}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-zinc-300 hover:text-white hover:bg-white/10 transition-colors active:scale-90 transform-gpu cursor-pointer">
                          {isMuted ? <VolumeX size={13} strokeWidth={2} /> : <Volume2 size={13} strokeWidth={2} />}
                        </button>
                        <button
                          type="button"
                          onClick={toggleVideoMode}
                          aria-label="Volver a imágenes"
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors active:scale-90 transform-gpu cursor-pointer">
                          <ImageIcon size={13} strokeWidth={2} />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={toggleVideoMode}
                        className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-xl text-white text-[11px] font-semibold tracking-tight shadow-lg transition-all duration-150 active:scale-95 transform-gpu cursor-pointer">
                        <Play size={11} className="fill-white" />
                        <span>Trailer</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Contenedor de Información del Juego */}
              <div className="relative z-20 px-4 pb-3.5 pt-1">
                {/* Fila Superior: Badges e Indicadores */}
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  {game.editionLabel ? (
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wider bg-white/6 text-zinc-200">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                      {game.editionLabel}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-semibold tracking-wider text-zinc-400 bg-white/4">
                      {isCatalog ? "Catálogo" : "Biblioteca"}
                    </span>
                  )}

                  <div className="flex items-center gap-1.5 text-zinc-400 text-[10px]">
                    {game.steamAppId && (
                      <span className="font-mono text-[9px] text-zinc-500 font-medium">ID: {game.steamAppId}</span>
                    )}
                    {!isCatalog && (
                      <div className="flex items-center gap-1 text-primary" title="Sincronizado con SaveCloud">
                        <Cloud size={13} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Título y Subtítulo */}
                <div className="mb-2.5">
                  <h3
                    className="text-[13px] font-bold text-white tracking-tight leading-snug line-clamp-1"
                    title={displayName}>
                    {displayName}
                  </h3>
                  {isCatalog && storeName && storeName.trim() !== displayName && (
                    <p className="text-[10.5px] text-zinc-400 line-clamp-1 font-medium mt-0.5">{storeName}</p>
                  )}
                </div>

                {/* Métricas y Estadísticas (si están disponibles en la biblioteca) */}
                {!isCatalog && stats && (
                  <div className="grid grid-cols-3 gap-1.5 p-2.5 rounded-xl bg-white/3 mb-2.5">
                    <div className="flex flex-col min-w-0">
                      <span className="text-[8.5px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                        <Clock size={9} className="text-primary shrink-0" />
                        {t("library.gameCardStats.played", "Jugado")}
                      </span>
                      <span className="text-[10.5px] font-bold font-mono text-zinc-200 truncate mt-0.5">
                        {formatPlaytime(stats.playtimeSeconds)}
                      </span>
                    </div>

                    <div className="flex flex-col min-w-0 border-l border-white/6 pl-1.5">
                      <span className="text-[8.5px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                        <HardDrive size={9} className="text-zinc-400 shrink-0" />
                        {t("library.gameCardStats.saved", "Guardado")}
                      </span>
                      <span className="text-[10.5px] font-bold font-mono text-zinc-200 truncate mt-0.5">
                        {formatBytes(stats.localSizeBytes)}
                      </span>
                    </div>

                    <div className="flex flex-col min-w-0 border-l border-white/6 pl-1.5">
                      <span className="text-[8.5px] font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1">
                        <Calendar size={9} className="text-zinc-400 shrink-0" />
                        {t("library.gameCardStats.lastTime", "Última vez")}
                      </span>
                      <span
                        className="text-[10px] font-semibold text-zinc-300 truncate mt-0.5"
                        title={formatRelativeDate(stats.localLastModified)}>
                        {formatRelativeDate(stats.localLastModified)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Géneros / Etiquetas sin bordes duros */}
                {genres.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {genres.slice(0, 4).map((genre, i) => (
                      <span
                        key={`${genre}-${i}`}
                        className="text-[9.5px] font-medium px-2 py-0.5 rounded-md bg-white/4 hover:bg-white/8 text-zinc-300 truncate tracking-wide transition-colors">
                        {genre}
                      </span>
                    ))}
                  </div>
                )}

                {/* Micro-Footer con estado de ejecución o acción */}
                <div className="pt-2 mt-2 border-t border-white/4 flex items-center justify-between text-[9.5px] text-zinc-400 font-medium">
                  <div className="flex items-center gap-1.5 truncate">
                    <Gamepad2 size={12} className="text-zinc-400 shrink-0" />
                    <span className="truncate">
                      {game.launchExecutablePath
                        ? "Listo para iniciar"
                        : isCatalog
                          ? "Ver en catálogo"
                          : "Guardados sincronizados"}
                    </span>
                  </div>

                  <span className="text-zinc-400 text-[8.5px] font-mono shrink-0">
                    {isCatalog ? "SAVECLOUD" : "CLOUD ACTIVE"}
                  </span>
                </div>
              </div>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>

      {hasVideo && videoUrl && (
        <GameVideoModal isOpen={showVideoModal} onClose={() => setShowVideoModal(false)} videoUrl={videoUrl} />
      )}
    </>
  );
}
