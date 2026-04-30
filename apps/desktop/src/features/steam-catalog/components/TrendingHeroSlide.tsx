import { Button } from "@heroui/react";
import { ArrowRight, Flame } from "lucide-react";
import type { CatalogListItem, SteamAppdetailsMediaResult } from "@services/tauri";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getGalleryForCatalogItem,
  getImageForCatalogItem,
  getLibraryHeroUrl,
  getRecommendationCopyVariant,
} from "@features/steam-catalog/components/steamCatalogTrendingHero.utils";

type TrendingHeroSlideProps = {
  featured: CatalogListItem;
  relatedItems: CatalogListItem[];
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  onOpenGame: (item: CatalogListItem) => void;
};

export function TrendingHeroSlide({ featured, relatedItems, mediaBySteamAppId, onOpenGame }: TrendingHeroSlideProps) {
  const gallery = useMemo(() => getGalleryForCatalogItem(featured, mediaBySteamAppId), [featured, mediaBySteamAppId]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [hasManualImageSelection, setHasManualImageSelection] = useState(false);
  const [failedHeroUrls, setFailedHeroUrls] = useState<Set<string>>(new Set());
  const recommendationCopy = useMemo(() => getRecommendationCopyVariant(), [featured.steamAppId]);

  useEffect(() => {
    setActiveImageIndex(0);
    setHasManualImageSelection(false);
    setFailedHeroUrls(new Set());
  }, [featured.steamAppId]);

  const heroCandidates = useMemo(() => {
    if (hasManualImageSelection) {
      const selected = gallery[activeImageIndex] ?? null;
      const rest = gallery.filter((url) => url !== selected);
      return [selected, ...rest].filter((url): url is string => Boolean(url));
    }

    return [getLibraryHeroUrl(featured.steamAppId), ...gallery].filter((url): url is string => Boolean(url));
  }, [featured.steamAppId, gallery, activeImageIndex, hasManualImageSelection]);

  const featuredImage = heroCandidates.find((url) => !failedHeroUrls.has(url)) ?? null;
  const handleHeroImageError = useCallback((url: string) => {
    setFailedHeroUrls((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  const featuredGenres = mediaBySteamAppId?.[featured.steamAppId]?.genres ?? [];
  const sideThumbs = gallery.slice(0, 4);

  return (
    <div className="grid h-full grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
      <article className="group relative h-full overflow-hidden">
        {featuredImage ? (
          <img
            src={featuredImage}
            alt={featured.name}
            className="absolute inset-0 h-full w-full object-cover object-center"
            loading="lazy"
            decoding="async"
            onError={() => handleHeroImageError(featuredImage)}
          />
        ) : (
          <div className="absolute inset-0 bg-linear-to-br from-default-900 via-default-800 to-default-700" />
        )}

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

      <aside className="relative flex flex-col justify-center border-t border-default-200/80 bg-[radial-gradient(circle_at_top,#0f2a4b_0%,#0b1a2d_42%,#0a1422_100%)] p-4 text-white lg:border-l lg:border-t-0 lg:border-default-100/15">
        <div className="space-y-3">
          <p className="text-3xl font-semibold leading-none tracking-tight">{featured.name}</p>
          <p className="text-3xl font-semibold leading-none tracking-tight text-primary">Recomendado</p>
          <p className="text-sm text-white/90">{recommendationCopy}</p>

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
                onClick={() => {
                  setHasManualImageSelection(true);
                  setActiveImageIndex(index);
                }}>
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
                  const image = getImageForCatalogItem(item, mediaBySteamAppId);
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
