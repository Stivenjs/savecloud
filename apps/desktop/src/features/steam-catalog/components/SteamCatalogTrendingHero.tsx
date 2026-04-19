import { Button } from "@heroui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addTransitionType, startTransition } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { CatalogListItem, SteamAppdetailsMediaResult } from "@services/tauri";
import { Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperType } from "swiper";
import { useMemo, useState } from "react";
import { SteamCatalogTrendingHeroSkeleton } from "@features/steam-catalog/components/SteamCatalogTrendingHeroSkeleton";
import {
  getSecondaryItemsForSlide,
  toRouteGameId,
} from "@features/steam-catalog/components/steamCatalogTrendingHero.utils";
import { TrendingHeroSlide } from "@features/steam-catalog/components/TrendingHeroSlide";

type SteamCatalogTrendingHeroProps = {
  items: CatalogListItem[];
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage?: string | null;
};

export function SteamCatalogTrendingHero({
  items,
  mediaBySteamAppId,
  isLoading,
  isError,
  errorMessage,
}: SteamCatalogTrendingHeroProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [swiper, setSwiper] = useState<SwiperType | null>(null);

  const slides = useMemo(() => items, [items]);

  const secondaryForSlide = (activeIndex: number): CatalogListItem[] =>
    getSecondaryItemsForSlide(slides, activeIndex, 4);

  const openGame = (item: CatalogListItem) => {
    startTransition(() => {
      addTransitionType("game-detail");
      navigate(`/games/${toRouteGameId(item)}`, {
        state: { resolvedSteamAppId: item.steamAppId, from: `${location.pathname}${location.search}` },
      });
    });
  };

  if (isLoading) {
    return <SteamCatalogTrendingHeroSkeleton />;
  }

  if (isError) {
    return (
      <section className="rounded-2xl border border-danger-300/70 bg-danger-100/70 p-4 text-sm text-danger-700 dark:border-danger-500/50 dark:bg-danger-950/50 dark:text-danger-100">
        {errorMessage ?? "No se pudo cargar el bloque de destacados."}
      </section>
    );
  }

  if (!slides.length) {
    return null;
  }

  return (
    <section className="space-y-3" aria-label="Destacados y recomendados">
      <div className="relative">
        <Button
          isIconOnly
          variant="flat"
          className="absolute -left-2 top-1/2 z-20 hidden size-11 -translate-y-1/2 rounded-none bg-content1/70 text-foreground backdrop-blur-md lg:flex"
          onPress={() => swiper?.slidePrev()}
          aria-label="Anterior">
          <ChevronLeft size={28} />
        </Button>

        <Button
          isIconOnly
          variant="flat"
          className="absolute -right-2 top-1/2 z-20 hidden size-11 -translate-y-1/2 rounded-none bg-content1/70 text-foreground backdrop-blur-md lg:flex"
          onPress={() => swiper?.slideNext()}
          aria-label="Siguiente">
          <ChevronRight size={28} />
        </Button>

        <Swiper
          modules={[Pagination]}
          onSwiper={setSwiper}
          loop={slides.length > 1}
          slidesPerView={1}
          speed={520}
          pagination={{ clickable: true, el: ".sg-trending-pagination" }}
          className="sg-trending-swiper overflow-hidden rounded-2xl border border-default-200/70 bg-content1 shadow-sm dark:border-default-100/15">
          {slides.map((featured, slideIndex) => (
            <SwiperSlide key={featured.steamAppId}>
              <TrendingHeroSlide
                featured={featured}
                relatedItems={secondaryForSlide(slideIndex)}
                mediaBySteamAppId={mediaBySteamAppId}
                onOpenGame={openGame}
              />
            </SwiperSlide>
          ))}
        </Swiper>

        <div className="sg-trending-pagination mt-2" aria-label="Paginacion destacados" />
      </div>
    </section>
  );
}
