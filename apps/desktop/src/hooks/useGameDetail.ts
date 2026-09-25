import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation } from "react-router-dom";
import {
  getConfig,
  getSteamAppDetails,
  getSteamCatalogListingName,
  getGameStats,
  type SteamAppDetailsResult,
  type SteamAppdetailsMediaResult,
  type GameStats,
} from "@services/tauri";
import { useProfileSession } from "@hooks/useProfileSession";
import { useGameRunningStatus } from "@hooks/useGameRunningStatus";
import { getGameLibraryHeroUrl, getSteamAppId, isSteamMoviePosterUrl, isSteamAppId } from "@utils/gameImage";
import { configuredGameFromSteamCatalogRouteId, isSteamCatalogRouteGameId } from "@utils/steamCatalogGameId";
import { hasUsableCloudConnection } from "@utils/cloudConnection";
import { buildActiveCloudConfig } from "@utils/activeCloudConfig";
import type { ConfiguredGame } from "@app-types/config";

export interface GameDetailLocationState {
  resolvedSteamAppId?: string | null;
  /** Ruta desde la que se abrió el detalle (lista, catálogo, etc.). */
  from?: string;
  /** Nombre del ítem en el catálogo Steam; evita matchear con el id sintético `steam-catalog:…`. */
  catalogDisplayName?: string;
}

export function useGameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const location = useLocation();
  const navState = location.state as GameDetailLocationState | undefined;
  const { activeProfile } = useProfileSession();
  const queryClient = useQueryClient();

  const { data: config, isLoading: isConfigLoading } = useQuery({
    queryKey: ["config"],
    queryFn: getConfig,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const game: ConfiguredGame | undefined = useMemo(() => {
    if (!gameId) return undefined;
    const fromConfig = config?.games.find((g) => g.id === gameId);
    if (fromConfig) return fromConfig;
    return configuredGameFromSteamCatalogRouteId(gameId) ?? undefined;
  }, [config?.games, gameId]);

  const steamAppId = useMemo(
    () => (game ? getSteamAppId(game, navState?.resolvedSteamAppId) : null),
    [game, navState?.resolvedSteamAppId]
  );

  const isCatalogRoute = isSteamCatalogRouteGameId(gameId);

  const { data: steamDetails, isLoading: isSteamLoading } = useQuery<SteamAppDetailsResult>({
    queryKey: ["steam-app-details", steamAppId],
    queryFn: () => getSteamAppDetails(steamAppId!),
    enabled: !!steamAppId && isSteamAppId(steamAppId),
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const catalogMedia = useMemo(() => {
    if (!steamAppId || !isSteamAppId(steamAppId)) return null;
    const cache = queryClient.getQueryData<Record<string, SteamAppdetailsMediaResult>>([
      "steam-catalog-global-media-cache",
    ]);
    return cache?.[steamAppId] ?? null;
  }, [queryClient, steamAppId]);

  const { data: catalogListingName } = useQuery({
    queryKey: ["steam-catalog-listing-name", steamAppId],
    queryFn: () => getSteamCatalogListingName(steamAppId!),
    enabled: isCatalogRoute && !!steamAppId && isSteamAppId(steamAppId),
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  const { data: allStats } = useQuery<GameStats[]>({
    queryKey: ["game-stats"],
    queryFn: getGameStats,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const stats = useMemo(() => allStats?.find((s) => s.gameId === gameId) ?? null, [allStats, gameId]);

  const runningByGame = useGameRunningStatus(gameId ? [gameId] : []);
  const isGameRunning = gameId ? (runningByGame[gameId] ?? false) : false;

  // Primera URL = header (~460px); se omite. Se excluyen pósters de trailers (baja calidad).
  const mediaUrls = useMemo(() => {
    const raw = steamDetails?.media.mediaUrls?.length ? steamDetails.media.mediaUrls : catalogMedia?.mediaUrls;
    if (!raw?.length) return [];
    return raw.slice(1).filter((u) => !isSteamMoviePosterUrl(u));
  }, [steamDetails, catalogMedia]);

  const videoUrl = steamDetails?.media.videoUrl ?? catalogMedia?.videoUrl ?? null;

  const libraryHeroFallbackUrl = useMemo(() => {
    if (!game) return null;
    return getGameLibraryHeroUrl(game, navState?.resolvedSteamAppId);
  }, [game, navState?.resolvedSteamAppId]);

  const isLoading =
    !gameId || (!isCatalogRoute && isConfigLoading) || (!!steamAppId && isSteamLoading && !catalogMedia);

  const cloudConfig = useMemo(() => buildActiveCloudConfig(config, activeProfile), [config, activeProfile]);

  return {
    gameId: gameId ?? "",
    game: game ?? null,
    steamAppId,
    steamDetails: steamDetails ?? null,
    stats,
    isGameRunning,
    mediaUrls,
    libraryHeroFallbackUrl,
    videoUrl,
    isLoading,
    hasSyncConfig: hasUsableCloudConnection(cloudConfig),
    isSteamCatalogOnly: isCatalogRoute,
    /** Ruta para volver con atrás; si falta, el detalle usa `navigate(-1)`. */
    backToPath: navState?.from ?? null,
    catalogDisplayName: navState?.catalogDisplayName?.trim() || null,
    catalogListingName: catalogListingName?.trim() || null,
  };
}
