import { useCallback, useEffect, useState } from "react";
import { Swiper, SwiperSlide } from "swiper/react";
import { Thumbs } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import { Skeleton } from "@heroui/react";
import { VideoPlayer } from "@/features/game-detail/media-viewer/VideoPlayer";
import { MediaThumbnailGallery, buildMediaItems } from "@/features/game-detail/media-viewer/MediaThumbnailGallery";
import "swiper/css";
import "swiper/css/thumbs";

export interface GameMediaViewerProps {
  /** URLs de las imágenes del juego. */
  imageUrls: string[];
  /** URL del video del juego (opcional). */
  videoUrl?: string | null;
  /** Nombre del juego para textos alternativos. */
  gameName: string;
  /** Mostrar video primero si está disponible. Por defecto: true. */
  videoFirst?: boolean;
  /** Clase CSS adicional para el contenedor. */
  className?: string;
  /** Callback cuando cambia el slide activo. Recibe el índice y la instancia del swiper. */
  onSlideChange?: (index: number, swiper: SwiperType) => void;
  /** Índice inicial del slide. Por defecto: 0. */
  initialSlide?: number;
  /** Si es true, muestra thumbnails internamente. Por defecto: false. */
  showThumbnails?: boolean;
  /** Ref expuesta para controlar la navegación desde fuera. */
  onSwiper?: (swiper: SwiperType) => void;
}

/**
 * Componente principal de visualización de media para juegos.
 *
 * Extiende la galería existente (Swiper) para soportar video sin
 * reemplazar la funcionalidad actual. Integra el video como un
 * elemento adicional en la galería con thumbnails de navegación.
 *
 * Características:
 * - Video se muestra primero si está disponible (auto-muted, auto-play)
 * - Navegación fluida entre video e imágenes usando Swiper
 * - Thumbnails tipo Steam para selección directa
 * - Reutiliza la lógica de video existente (HLS.js)
 * - Mantiene 100% compatibilidad con la galería de imágenes actual
 */
export function GameMediaViewer({
  imageUrls,
  videoUrl,
  gameName,
  videoFirst = true,
  className = "",
  onSlideChange,
  initialSlide = 0,
  showThumbnails = true,
  onSwiper,
}: GameMediaViewerProps) {
  const [swiperInstance, setSwiperInstance] = useState<SwiperType | null>(null);
  const [activeIndex, setActiveIndex] = useState(initialSlide);
  const [loadedSlides, setLoadedSlides] = useState<Set<number>>(new Set());

  // Handler que combina el estado interno con el callback del padre
  const handleSwiperInit = useCallback(
    (swiper: SwiperType) => {
      setSwiperInstance(swiper);
      onSwiper?.(swiper);
    },
    [onSwiper]
  );

  // Construir items de media (video + imágenes)
  const mediaItems = buildMediaItems(videoFirst ? videoUrl : null, imageUrls);

  // Si no hay video o videoFirst es false, reconstruir solo con imágenes
  const displayItems = videoFirst ? mediaItems : buildMediaItems(null, imageUrls);

  // Actualizar slide activo desde Swiper
  const handleSlideChange = useCallback(
    (swiper: SwiperType) => {
      const newIndex = swiper.activeIndex;
      setActiveIndex(newIndex);
      onSlideChange?.(newIndex, swiper);
    },
    [onSlideChange]
  );

  // Manejar carga de slide
  const handleSlideLoad = useCallback((index: number) => {
    setLoadedSlides((prev) => new Set(prev).add(index));
  }, []);

  // Navegar a un slide específico desde thumbnails
  const navigateToSlide = useCallback(
    (index: number) => {
      swiperInstance?.slideTo(index);
    },
    [swiperInstance]
  );

  // Precargar siguiente imagen
  useEffect(() => {
    if (activeIndex < displayItems.length - 1) {
      const nextItem = displayItems[activeIndex + 1];
      if (nextItem?.type === "image") {
        const img = new Image();
        img.src = nextItem.url;
      }
    }
  }, [activeIndex, displayItems]);

  // Si no hay media, mostrar placeholder
  if (displayItems.length === 0) {
    return (
      <div className={`relative aspect-21/9 w-full overflow-hidden rounded-b-lg bg-default-100 ${className}`}>
        <Skeleton className="size-full" />
      </div>
    );
  }

  const hasThumbnails = displayItems.length > 1;

  // Exponer navigateToSlide para uso externo mediante ref
  useEffect(() => {
    if (swiperInstance) {
      // Permitir navegación externa
      (swiperInstance as unknown as { navigateToSlide?: (index: number) => void }).navigateToSlide = (
        index: number
      ) => {
        swiperInstance.slideTo(index);
      };
    }
  }, [swiperInstance]);

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Main Swiper Gallery */}
      <div className="relative">
        <Swiper
          modules={[Thumbs]}
          onSwiper={handleSwiperInit}
          onSlideChange={handleSlideChange}
          initialSlide={initialSlide}
          spaceBetween={0}
          slidesPerView={1}
          className="aspect-21/9 w-full overflow-hidden rounded-b-lg"
          style={{ aspectRatio: "21/9" }}>
          {displayItems.map((item, index) => (
            <SwiperSlide key={item.id}>
              {item.type === "video" ? (
                // Video Slide
                <div className="relative size-full bg-black">
                  {!loadedSlides.has(index) && <Skeleton className="absolute inset-0 z-10 size-full" />}
                  <VideoPlayer
                    videoUrl={item.url}
                    autoPlay={index === activeIndex}
                    muted={true}
                    loop={true}
                    className="absolute inset-0"
                    onReady={() => handleSlideLoad(index)}
                    onError={() => handleSlideLoad(index)}
                  />
                </div>
              ) : (
                // Image Slide
                <div className="relative size-full">
                  {!loadedSlides.has(index) && <Skeleton className="absolute inset-0 z-10 size-full" />}
                  <img
                    src={item.url}
                    alt={item.alt || `${gameName} captura ${index + 1}`}
                    className="size-full object-cover object-center"
                    loading={index === 0 ? "eager" : "lazy"}
                    decoding="async"
                    fetchPriority={index === 0 ? "high" : "auto"}
                    onLoad={() => handleSlideLoad(index)}
                  />
                </div>
              )}
            </SwiperSlide>
          ))}
        </Swiper>
      </div>

      {/* Thumbnail Navigation (Steam-style) */}
      {hasThumbnails && showThumbnails && (
        <MediaThumbnailGallery items={displayItems} activeIndex={activeIndex} onSelect={navigateToSlide} />
      )}
    </div>
  );
}
