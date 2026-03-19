import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSteamAppdetailsMedia } from "@services/tauri";
import { getGameImageUrl, getGameLibraryHeroUrl, getSteamAppId } from "@utils/gameImage";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";

interface UseGameMediaOptions {
  game: ConfiguredGame;
  resolvedSteamAppId?: string | null;
  externalLoading?: boolean;
  mediaBySteamAppId?: Record<string, SteamAppdetailsMediaResult> | null;
  mediaFromBatch?: boolean;
}

export function useGameMedia({
  game,
  resolvedSteamAppId,
  externalLoading = false,
  mediaBySteamAppId,
  mediaFromBatch = false,
}: UseGameMediaOptions) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const staticImageUrl = getGameImageUrl(game, resolvedSteamAppId);
  const extraImageUrl = getGameLibraryHeroUrl(game, resolvedSteamAppId);
  const steamAppId = getSteamAppId(game, resolvedSteamAppId);

  const { data: appdetailsMedia, isPending: isSteamQueryPending } = useQuery({
    queryKey: ["steam-appdetails-media", steamAppId ?? ""],
    queryFn: () => getSteamAppdetailsMedia(steamAppId!),
    enabled: !!steamAppId && !mediaFromBatch,
    staleTime: 5 * 60 * 1000,
  });

  const mediaSource = (mediaBySteamAppId && steamAppId ? mediaBySteamAppId[steamAppId] : undefined) ?? appdetailsMedia;

  const { displayImageUrl, mediaUrls, isEffectivelyLoading } = useMemo(() => {
    const isCustomImage = !!game.imageUrl?.trim();
    const fallbackDisplay = staticImageUrl ?? "";
    const fallbackUrls = [fallbackDisplay, extraImageUrl].filter(Boolean) as string[];

    if (isCustomImage) {
      return { displayImageUrl: fallbackDisplay, mediaUrls: fallbackUrls, isEffectivelyLoading: false };
    }

    if (mediaSource?.mediaUrls?.length) {
      return {
        displayImageUrl: mediaSource.mediaUrls[0],
        mediaUrls: mediaSource.mediaUrls,
        isEffectivelyLoading: false,
      };
    }

    const isWaiting =
      externalLoading ||
      (!!steamAppId && !mediaFromBatch && isSteamQueryPending) ||
      (!!steamAppId && mediaFromBatch && !mediaBySteamAppId);

    if (isWaiting) {
      return { displayImageUrl: null, mediaUrls: [], isEffectivelyLoading: true };
    }

    return { displayImageUrl: fallbackDisplay, mediaUrls: fallbackUrls, isEffectivelyLoading: false };
  }, [
    game.imageUrl,
    staticImageUrl,
    extraImageUrl,
    mediaSource,
    externalLoading,
    steamAppId,
    mediaFromBatch,
    isSteamQueryPending,
    mediaBySteamAppId,
  ]);

  useEffect(() => {
    setImgError(false);
    setImgLoaded(false);
  }, [displayImageUrl]);

  const handleImgLoad = useCallback(() => setImgLoaded(true), []);
  const handleImgError = useCallback(() => setImgError(true), []);

  return {
    displayImageUrl,
    mediaUrls,
    videoUrl: mediaSource?.videoUrl ?? null,
    isEffectivelyLoading,
    imgLoaded,
    imgError,
    handleImgLoad,
    handleImgError,
  };
}
