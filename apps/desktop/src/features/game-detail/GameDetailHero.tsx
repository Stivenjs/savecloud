import { ViewTransition } from "react";
import { Button, Skeleton } from "@heroui/react";
import { ArrowLeft, Gamepad2 } from "lucide-react";
import { GameMediaViewer, MediaThumbnailGallery, buildMediaItems } from "@/features/game-detail/media-viewer";
import { useState, useCallback } from "react";
import type { Swiper as SwiperType } from "swiper";
import { useLowPerformanceMode } from "@/hooks/useLowPerformanceMode";

function MaybeViewTransition({
  name,
  share,
  disabled,
  children,
}: {
  name: string;
  share?: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) return <>{children}</>;
  return (
    <ViewTransition name={name} share={share} default="none">
      {children}
    </ViewTransition>
  );
}

interface GameDetailHeroProps {
  mediaUrls: string[];
  /** Imagen ancha de Steam (header ~460px) solo si no hay capturas ni library hero. */
  headerImage?: string | null;
  /** Imagen ancha de biblioteca Steam (~3840px); mejor que header para hero. */
  libraryHeroFallbackUrl?: string | null;
  /** Imagen personalizada del juego (no Steam). */
  customImageUrl?: string | null;
  /** URL del video del juego (opcional). Se mostrará primero si está disponible. */
  videoUrl?: string | null;
  gameName: string;
  editionLabel?: string | null;
  gameId: string;
  isLoading?: boolean;
  /** Vuelve a la lista anterior (misma lógica que atrás global / estado `from`). */
  onBack: () => void;
}

export function GameDetailHero({
  mediaUrls,
  headerImage,
  libraryHeroFallbackUrl,
  customImageUrl,
  videoUrl,
  gameName,
  editionLabel,
  gameId,
  isLoading,
  onBack,
}: GameDetailHeroProps) {
  const isLowPerf = useLowPerformanceMode();
  const [swiper, setSwiper] = useState<SwiperType | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const heroSlides =
    mediaUrls.length > 0
      ? mediaUrls
      : customImageUrl
        ? [customImageUrl]
        : libraryHeroFallbackUrl
          ? [libraryHeroFallbackUrl]
          : headerImage
            ? [headerImage]
            : [];

  // Construir items de media para thumbnails
  const mediaItems = buildMediaItems(videoUrl, heroSlides);
  const hasMultipleItems = mediaItems.length > 1;

  const handleSlideChange = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const handleThumbnailSelect = useCallback(
    (index: number) => {
      swiper?.slideTo(index);
    },
    [swiper]
  );

  if (isLoading) {
    return (
      <MaybeViewTransition name={`game-hero-${gameId}`} share="hero-morph" disabled={isLowPerf}>
        <div className="-mx-6 -mt-16">
          <Skeleton className="aspect-21/9 w-full" />
        </div>
      </MaybeViewTransition>
    );
  }

  if (!heroSlides.length && !videoUrl) {
    return (
      <MaybeViewTransition name={`game-hero-${gameId}`} share="hero-morph" disabled={isLowPerf}>
        <div className="group/hero relative -mx-6 -mt-16 w-[calc(100%+3rem)] overflow-hidden">
          <div className="flex aspect-21/9 w-full items-center justify-center bg-linear-to-br from-default-100 to-default-200 dark:from-default-50/30 dark:to-default-100/20">
            <Gamepad2 size={64} className="text-default-300" strokeWidth={1.2} />
          </div>
          <HeroGradient />
          <TitleOverlay editionLabel={editionLabel} gameName={gameName} />
          <BackButton onPress={onBack} />
        </div>
      </MaybeViewTransition>
    );
  }

  return (
    <MaybeViewTransition name={`game-hero-${gameId}`} share="hero-morph" disabled={isLowPerf}>
      <div className="relative -mx-6 -mt-16 w-[calc(100%+3rem)]">
        {/* Hero con media viewer (sin thumbnails internos) */}
        <div className="group/hero relative overflow-hidden">
          <GameMediaViewer
            imageUrls={heroSlides}
            videoUrl={videoUrl}
            gameName={gameName}
            videoFirst={true}
            showThumbnails={false}
            onSwiper={setSwiper}
            onSlideChange={handleSlideChange}
            className="relative"
          />

          <HeroGradient />
          <TitleOverlay editionLabel={editionLabel} gameName={gameName} />
          <BackButton onPress={onBack} />
        </div>

        {/* Thumbnails debajo del hero */}
        {hasMultipleItems && (
          <div className="px-6 pt-3">
            <MediaThumbnailGallery items={mediaItems} activeIndex={activeIndex} onSelect={handleThumbnailSelect} />
          </div>
        )}
      </div>
    </MaybeViewTransition>
  );
}

function HeroGradient() {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-24 bg-linear-to-b from-black/50 to-transparent" />
    </>
  );
}

function TitleOverlay({ gameName, editionLabel }: { gameName: string; editionLabel?: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-20 z-20 px-5 sm:px-6">
      <h1 className="text-balance text-2xl font-bold tracking-tight text-white drop-shadow-md sm:text-3xl md:text-4xl">
        {gameName}
      </h1>
      {editionLabel ? <p className="mt-1 text-sm font-medium text-white/85 drop-shadow">{editionLabel}</p> : null}
    </div>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Button
      variant="flat"
      size="sm"
      isIconOnly
      onPress={onPress}
      className="absolute left-4 top-4 z-30 bg-black/45 text-white backdrop-blur-md hover:bg-black/65"
      aria-label="Volver">
      <ArrowLeft size={18} />
    </Button>
  );
}
