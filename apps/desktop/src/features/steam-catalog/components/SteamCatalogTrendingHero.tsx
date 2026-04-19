import { Button, Skeleton } from "@heroui/react";
import { Flame, ArrowRight, Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
import { addTransitionType, startTransition } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { CatalogListItem, SteamAppdetailsMediaResult } from "@services/tauri";
import { STEAM_CATALOG_GAME_ID_PREFIX } from "@utils/steamCatalogGameId";
import { Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperType } from "swiper";
import { useEffect, useMemo, useState } from "react";

type SteamCatalogTrendingHeroProps = {
  items: CatalogListItem[];
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  errorMessage?: string | null;
};

function imageFor(
  item: CatalogListItem | null,
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null
): string | null {
  if (!item || !mediaBySteamAppId) return null;
  const media = mediaBySteamAppId[item.steamAppId];
  if (!media) return null;
  return media.mediaUrls[0] ?? media.capsuleImage ?? null;
}

function galleryFor(
  item: CatalogListItem,
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null
): string[] {
  const media = mediaBySteamAppId?.[item.steamAppId];
  if (!media) return [];

  const images = media.mediaUrls.filter(Boolean);
  if (images.length) return images;
  return media.capsuleImage ? [media.capsuleImage] : [];
}

function toRouteGameId(item: CatalogListItem): string {
  return `${STEAM_CATALOG_GAME_ID_PREFIX}${item.steamAppId}`;
}

export function SteamCatalogTrendingHero({
  items,
  mediaBySteamAppId,
  isLoading,
  isFetching,
  isError,
  errorMessage,
}: SteamCatalogTrendingHeroProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [swiper, setSwiper] = useState<SwiperType | null>(null);

  const slides = useMemo(() => items.slice(0, 8), [items]);

  const secondaryForSlide = (activeIndex: number): CatalogListItem[] => {
    if (slides.length <= 1) return [];

    const rest = slides.filter((_, idx) => idx !== activeIndex);
    return rest.slice(0, 4);
  };

  const openGame = (item: CatalogListItem) => {
    startTransition(() => {
      addTransitionType("game-detail");
      navigate(`/games/${toRouteGameId(item)}`, {
        state: { resolvedSteamAppId: item.steamAppId, from: `${location.pathname}${location.search}` },
      });
    });
  };

  if (isLoading) {
    return (
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]" aria-label="Destacados">
        <Skeleton className="h-72 w-full rounded-2xl" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </section>
    );
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
      <div className="flex items-center gap-2 text-sm font-semibold text-default-700 dark:text-default-200">
        <Sparkles size={16} className="text-primary" />
        Destacados y recomendados
        {isFetching ? <span className="text-xs text-default-400">Actualizando…</span> : null}
      </div>

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

type TrendingHeroSlideProps = {
  featured: CatalogListItem;
  relatedItems: CatalogListItem[];
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  onOpenGame: (item: CatalogListItem) => void;
};

function TrendingHeroSlide({ featured, relatedItems, mediaBySteamAppId, onOpenGame }: TrendingHeroSlideProps) {
  const gallery = useMemo(() => galleryFor(featured, mediaBySteamAppId), [featured, mediaBySteamAppId]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [featured.steamAppId]);

  const featuredImage = gallery[activeImageIndex] ?? imageFor(featured, mediaBySteamAppId);
  const featuredGenres = mediaBySteamAppId?.[featured.steamAppId]?.genres ?? [];
  const sideThumbs = gallery.slice(0, 4);

  return (
    <div className="grid min-h-80 grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
      <article className="group relative min-h-72 overflow-hidden">
        {featuredImage ? (
          <img
            src={featuredImage}
            alt={featured.name}
            className="absolute inset-0 h-full w-full object-cover object-center"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="absolute inset-0 bg-linear-to-br from-default-900 via-default-800 to-default-700" />
        )}

        <div className="absolute inset-0 bg-linear-to-r from-zinc-950/85 via-zinc-900/50 to-zinc-950/10" />
        <div className="absolute inset-0 bg-linear-to-t from-zinc-950/85 via-transparent to-transparent" />

        <div className="relative z-10 flex h-full flex-col justify-between p-5 sm:p-6">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/90">
            <Flame size={14} className="text-primary" />
            Trending
          </div>

          <div className="space-y-3">
            <h2 className="max-w-[18ch] text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              {featured.name}
            </h2>
            <Button
              size="sm"
              color="primary"
              className="font-semibold"
              endContent={<ArrowRight size={14} />}
              onPress={() => onOpenGame(featured)}>
              Ver ficha
            </Button>
          </div>
        </div>
      </article>

      <aside className="relative border-t border-default-200/80 bg-[radial-gradient(circle_at_top,#0f2a4b_0%,#0b1a2d_42%,#0a1422_100%)] p-4 text-white lg:border-l lg:border-t-0 lg:border-default-100/15">
        <div className="space-y-3">
          <p className="text-3xl font-semibold leading-none tracking-tight">{featured.name}</p>
          <p className="text-3xl font-semibold leading-none tracking-tight text-primary">Recomendado</p>
          <p className="text-sm text-white/90">porque has jugado titulos con las etiquetas similares.</p>

          <div className="grid grid-cols-2 gap-2">
            {sideThumbs.map((url, index) => (
              <button
                key={`${featured.steamAppId}-${url}`}
                type="button"
                className={`group/mini relative h-20 overflow-hidden rounded-sm border text-left transition-colors duration-200 ${
                  activeImageIndex === index
                    ? "border-primary/90 ring-1 ring-primary/70"
                    : "border-white/15 hover:border-white/45"
                }`}
                onClick={() => setActiveImageIndex(index)}>
                <img
                  src={url}
                  alt={`${featured.name} captura ${index + 1}`}
                  className="absolute inset-0 h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <div className="absolute inset-0 bg-black/35 transition-colors duration-200 group-hover/mini:bg-black/10" />
                <span className="absolute left-1.5 top-1.5 text-[10px] text-white/80">#{index + 1}</span>
              </button>
            ))}

            {sideThumbs.length < 4
              ? relatedItems.slice(0, 4 - sideThumbs.length).map((item, index) => {
                  const image = imageFor(item, mediaBySteamAppId);
                  return (
                    <button
                      key={item.steamAppId}
                      type="button"
                      className="group/mini relative h-20 overflow-hidden rounded-sm border border-white/15 text-left"
                      onClick={() => onOpenGame(item)}>
                      {image ? (
                        <img
                          src={image}
                          alt={item.name}
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-default-700" />
                      )}
                      <div className="absolute inset-0 bg-black/40 transition-colors duration-200 group-hover/mini:bg-black/15" />
                      <span className="absolute left-1.5 top-1.5 text-[10px] text-white/80">R{index + 1}</span>
                    </button>
                  );
                })
              : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {featuredGenres.slice(0, 2).map((genre) => (
              <span
                key={`${featured.steamAppId}-${genre}`}
                className="rounded bg-white/20 px-2 py-0.5 text-[11px] text-white/95">
                {genre}
              </span>
            ))}
          </div>
        </div>
      </aside>
    </div>
  );
}
