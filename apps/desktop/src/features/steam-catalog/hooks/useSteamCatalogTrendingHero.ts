import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getSteamAppdetailsMediaBatch,
  listSteamCatalogTrendingHero,
  type CatalogListItem,
  type SteamAppdetailsMediaResult,
} from "@services/tauri";

const HERO_TRENDING_LIMIT = 16;

export function useSteamCatalogTrendingHero(enabled: boolean) {
  const heroQuery = useQuery({
    queryKey: ["steamCatalog", "trendingHero", HERO_TRENDING_LIMIT],
    queryFn: () => listSteamCatalogTrendingHero(HERO_TRENDING_LIMIT),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const items = heroQuery.data ?? [];

  const mediaIds = useMemo(() => {
    const ids = items.map((item) => item.steamAppId).filter(Boolean);
    return [...new Set(ids)].sort();
  }, [items]);

  const mediaQuery = useQuery({
    queryKey: ["steamCatalog", "trendingHeroMedia", mediaIds.join(",")],
    queryFn: () => getSteamAppdetailsMediaBatch(mediaIds),
    enabled: enabled && mediaIds.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const isInitialLoading = heroQuery.isPending && !heroQuery.data;
  const isMediaPending = mediaIds.length > 0 && mediaQuery.isPending && !mediaQuery.data;

  return {
    items,
    mediaBySteamAppId: (mediaQuery.data ?? null) as Record<string, SteamAppdetailsMediaResult> | null,
    isLoading: isInitialLoading || isMediaPending,
    isError: heroQuery.isError,
    error: heroQuery.error as Error | null,
    isFetching: heroQuery.isFetching || mediaQuery.isFetching,
    hasData: items.length > 0,
  };
}

export function getHeroGameImage(
  item: CatalogListItem | null,
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null
): string | null {
  if (!item || !mediaBySteamAppId) return null;
  const media = mediaBySteamAppId[item.steamAppId];
  if (!media) return null;

  return media.mediaUrls[0] ?? media.capsuleImage ?? null;
}
