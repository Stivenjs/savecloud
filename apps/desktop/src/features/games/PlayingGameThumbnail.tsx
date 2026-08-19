import { useMemo, useState, useEffect, useCallback } from "react";
import { Gamepad2 } from "lucide-react";
import { Skeleton } from "@heroui/react";
import { useQuery } from "@tanstack/react-query";
import { useConfig } from "@hooks/useConfig";
import { searchSteamAppId } from "@services/tauri";
import { globalFailedImages, globalLoadedImages } from "@hooks/useGameMedia";
import {
  extractAppIdFromId,
  extractAppIdFromFolderName,
  isSteamAppId,
  getSteamThumbnailCandidates,
  getSteamCdnCandidates,
  formatGameDisplayName,
  idToSearchQuery,
  findConfiguredGame,
} from "@utils/gameImage";

export interface PlayingGameThumbnailProps {
  gameId?: string | null;
  gameName?: string | null;
  imageUrl?: string | null;
  steamAppId?: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  showGlow?: boolean;
}

const SIZE_CLASSES = {
  xs: "h-5 w-8 rounded-[4px]",
  sm: "h-7 w-12 rounded-[6px]",
  md: "h-9 w-16 rounded-[7px]",
  lg: "h-12 w-20 rounded-[8px]",
} as const;

const ICON_SIZES = {
  xs: 11,
  sm: 14,
  md: 17,
  lg: 22,
} as const;

export function PlayingGameThumbnail({
  gameId,
  gameName,
  imageUrl,
  steamAppId,
  size = "sm",
  className = "",
  showGlow = false,
}: PlayingGameThumbnailProps) {
  const { config } = useConfig();
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [hasError, setHasError] = useState(false);

  const configuredGame = useMemo(() => {
    return findConfiguredGame(config?.games, gameId) || findConfiguredGame(config?.games, gameName);
  }, [config?.games, gameId, gameName]);

  const resolvedSteamAppId = useMemo(() => {
    if (steamAppId?.trim()) return steamAppId.trim();
    if (configuredGame?.steamAppId?.trim()) return configuredGame.steamAppId.trim();

    if (gameId?.trim()) {
      const fromId = extractAppIdFromId(gameId);
      if (fromId) return fromId;
      const fromFolder = extractAppIdFromFolderName(gameId);
      if (fromFolder) return fromFolder;
      if (isSteamAppId(gameId)) return gameId.trim();
    }

    if (gameName?.trim()) {
      const fromName = extractAppIdFromFolderName(gameName);
      if (fromName) return fromName;
    }

    return null;
  }, [steamAppId, configuredGame, gameId, gameName]);

  const customCover = imageUrl?.trim() || configuredGame?.imageUrl?.trim() || null;

  const searchQuery = useMemo(() => {
    if (customCover || resolvedSteamAppId) return null;
    const raw = (gameName?.trim() || (gameId ? formatGameDisplayName(gameId) : "")).trim();
    if (!raw) return null;
    return idToSearchQuery(raw);
  }, [customCover, resolvedSteamAppId, gameName, gameId]);

  const { data: searchedSteamAppId, isLoading: isSearchingAppId } = useQuery({
    queryKey: ["steam-app-id-search", searchQuery],
    queryFn: () => (searchQuery ? searchSteamAppId(searchQuery) : null),
    enabled: !!searchQuery,
    staleTime: 1000 * 60 * 60 * 24,
    gcTime: 1000 * 60 * 60 * 24 * 7,
    refetchOnWindowFocus: false,
  });

  const effectiveSteamAppId = resolvedSteamAppId || searchedSteamAppId || null;

  const candidateUrls = useMemo(() => {
    const urls: string[] = [];

    if (customCover) {
      urls.push(customCover);
    }

    if (effectiveSteamAppId) {
      urls.push(...getSteamThumbnailCandidates(effectiveSteamAppId));
      urls.push(...getSteamCdnCandidates(effectiveSteamAppId));
    }

    const unique = [...new Set(urls.filter(Boolean))];
    return unique.filter((url) => !globalFailedImages.has(url));
  }, [customCover, effectiveSteamAppId]);

  useEffect(() => {
    setCandidateIndex(0);
    setHasError(false);
  }, [candidateUrls.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentSrc = candidateUrls[candidateIndex];
  const [isLoaded, setIsLoaded] = useState(() => (currentSrc ? globalLoadedImages.has(currentSrc) : false));

  useEffect(() => {
    if (currentSrc && globalLoadedImages.has(currentSrc)) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [currentSrc]);

  const handleImgLoad = useCallback(() => {
    if (currentSrc) {
      globalLoadedImages.add(currentSrc);
    }
    setIsLoaded(true);
  }, [currentSrc]);

  const handleImgError = useCallback(() => {
    if (currentSrc) {
      globalFailedImages.add(currentSrc);
    }
    setIsLoaded(false);
    if (candidateIndex < candidateUrls.length - 1) {
      setCandidateIndex((i) => i + 1);
    } else {
      setHasError(true);
    }
  }, [currentSrc, candidateIndex, candidateUrls.length]);

  const sizeClass = SIZE_CLASSES[size] || SIZE_CLASSES.sm;
  const iconSize = ICON_SIZES[size] || ICON_SIZES.sm;
  const isLoading = isSearchingAppId || (Boolean(currentSrc) && !isLoaded && !hasError);

  return (
    <div
      className={`relative shrink-0 overflow-hidden bg-default-100 dark:bg-zinc-800 shadow-xs select-none ${sizeClass} ${
        showGlow ? "shadow-[0_0_12px_rgba(34,197,94,0.35)] ring-1 ring-emerald-500/40" : ""
      } ${className}`}>
      {/* Skeleton mientras busca el ID o mientras descarga la imagen */}
      {isLoading && <Skeleton className="absolute inset-0 z-10 size-full bg-default-200/50 dark:bg-zinc-700/50" />}

      {currentSrc && !hasError ? (
        <img
          key={currentSrc}
          src={currentSrc}
          alt={gameName || gameId || "Game"}
          className={`size-full object-cover transition-opacity duration-300 ${isLoaded ? "opacity-100" : "opacity-0"}`}
          loading="eager"
          decoding="async"
          onLoad={handleImgLoad}
          onError={handleImgError}
        />
      ) : !isLoading ? (
        <div className="flex size-full items-center justify-center bg-default-100 dark:bg-zinc-800 text-default-400 dark:text-zinc-400">
          <Gamepad2 size={iconSize} strokeWidth={1.75} />
        </div>
      ) : null}
    </div>
  );
}
