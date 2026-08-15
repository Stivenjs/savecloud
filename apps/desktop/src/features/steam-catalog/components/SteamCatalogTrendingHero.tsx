import { Button } from "@heroui/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { CatalogListItem, SteamAppdetailsMediaResult } from "@services/tauri";
import { Swiper, SwiperSlide } from "swiper/react";
import { Autoplay, EffectFade } from "swiper/modules";
import type { Swiper as SwiperType } from "swiper";
import "swiper/css/effect-fade";
import { useCallback, useMemo, useRef, useEffect } from "react";
import { SteamCatalogTrendingHeroSkeleton } from "@features/steam-catalog/components/SteamCatalogTrendingHeroSkeleton";
import {
  getSecondaryItemsForSlide,
  toRouteGameId,
} from "@features/steam-catalog/components/steamCatalogTrendingHero.utils";
import { TrendingHeroSlide } from "@features/steam-catalog/components/TrendingHeroSlide";
import { visibilityManager } from "@hooks/useAppVisibility";
import { useShellUiStore } from "@store/ShellUiStore";

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const swiperRef = useRef<SwiperType | null>(null);

  const handleSwiper = useCallback((instance: SwiperType) => {
    swiperRef.current = instance;

    if (!visibilityManager.isVisible) {
      instance.autoplay?.stop();
    }
  }, []);

  useEffect(() => {
    const unsub = visibilityManager.subscribe(
      () => swiperRef.current?.autoplay?.stop(),
      () => swiperRef.current?.autoplay?.start()
    );
    return unsub;
  }, []);

  const slides = useMemo(() => items, [items]);

  const secondaryForSlide = useCallback(
    (activeIndex: number): CatalogListItem[] => getSecondaryItemsForSlide(slides, activeIndex, 4),
    [slides]
  );

  const openGame = useCallback(
    (item: CatalogListItem) => {
      const currentY = window.scrollY || document.documentElement.scrollTop;
      if (currentY > 0) {
        useShellUiStore.getState().setCatalogScrollPosition(currentY);
      }
      navigate(`/games/${toRouteGameId(item)}`, {
        state: {
          resolvedSteamAppId: item.steamAppId,
          catalogDisplayName: item.name,
          from: `${location.pathname}${location.search}`,
        },
      });
    },
    [navigate, location.pathname, location.search]
  );

  if (isLoading) {
    return <SteamCatalogTrendingHeroSkeleton />;
  }

  if (isError) {
    return (
      <section className="rounded-2xl border border-danger-300/70 bg-danger-100/70 p-4 text-sm text-danger-700 dark:border-danger-500/50 dark:bg-danger-950/50 dark:text-danger-100">
        {errorMessage ?? t("steamCatalog.trending.errorLoading")}
      </section>
    );
  }

  if (!slides.length) {
    return null;
  }

  return (
    <section className="space-y-3" aria-label={t("steamCatalog.trending.featured")}>
      <div className="relative">
        <Button
          isIconOnly
          variant="flat"
          className="absolute -left-2 top-1/2 z-20 hidden size-11 -translate-y-1/2 rounded-none bg-content1/80 text-foreground lg:flex"
          onPress={() => swiperRef.current?.slidePrev()}
          aria-label={t("steamCatalog.trending.previousSlide")}>
          <ChevronLeft size={28} />
        </Button>

        <Button
          isIconOnly
          variant="flat"
          className="absolute -right-2 top-1/2 z-20 hidden size-11 -translate-y-1/2 rounded-none bg-content1/80 text-foreground lg:flex"
          onPress={() => swiperRef.current?.slideNext()}
          aria-label={t("steamCatalog.trending.nextSlide")}>
          <ChevronRight size={28} />
        </Button>

        <Swiper
          onSwiper={handleSwiper}
          loop={slides.length > 1}
          effect="fade"
          fadeEffect={{ crossFade: true }}
          modules={[Autoplay, EffectFade]}
          slidesPerView={1}
          autoplay={{
            delay: 3500,
            disableOnInteraction: false,
            pauseOnMouseEnter: true,
          }}
          speed={520}
          className="sg-trending-swiper min-h-95 overflow-hidden rounded-2xl border border-default-200/70 shadow-sm dark:border-default-100/15">
          {slides.map((featured, slideIndex) => (
            <SwiperSlide key={featured.steamAppId} className="h-auto!">
              <TrendingHeroSlide
                featured={featured}
                relatedItems={secondaryForSlide(slideIndex)}
                mediaBySteamAppId={mediaBySteamAppId}
                onOpenGame={openGame}
              />
            </SwiperSlide>
          ))}
        </Swiper>
      </div>
    </section>
  );
}
