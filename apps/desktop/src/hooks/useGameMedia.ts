import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSteamAppdetailsMedia, getSteamAppdetailsMediaBatch } from "@services/tauri";
import {
  getGameImageUrl,
  getGameLibraryHeroUrl,
  getSteamAppId,
  getSteamCdnCandidates,
  needsSteamSearch,
  isSteamAppId,
} from "@utils/gameImage";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";

/** Caché global de imágenes ya cargadas en esta sesión, evita re-spinner. */
export const globalLoadedImages = new Set<string>();

/** Caché global de imágenes fallidas (404/red), evita reintentar URLs rotas. */
export const globalFailedImages = new Set<string>();

/**
 * Opciones para {@link useGameMedia}.
 */
interface UseGameMediaOptions {
  /** Juego del que se quiere obtener media. */
  game: ConfiguredGame;
  /**
   * Steam App ID ya resuelto externamente (p.ej. tras búsqueda fuzzy).
   * Si no se pasa, el hook lo deriva de `game`.
   */
  resolvedSteamAppId?: string | null;
  /**
   * Señal de carga externa: mientras sea `true` el hook marca el estado
   * como "cargando" aunque no haya query en vuelo.
   */
  externalLoading?: boolean;
  /**
   * Mapa de media pre-cargada en batch `steamAppId → resultado`.
   * Cuando se proporciona, el hook individual queda desactivado.
   * `null` significa "batch todavía no ha respondido".
   */
  mediaBySteamAppId?: Record<string, SteamAppdetailsMediaResult> | null;
  /**
   * `true` cuando `mediaBySteamAppId` proviene de una carga batch
   * (desactiva la query individual para evitar duplicados).
   */
  mediaFromBatch?: boolean;
  /** Orientación de la tarjeta (vertical para póster 2:3, horizontal para cápsula 460x215). */
  orientation?: "vertical" | "horizontal";
}

/**
 * Valor devuelto por {@link useGameMedia}.
 */
export interface UseGameMediaResult {
  /** URL de la imagen principal a mostrar, o `null` mientras carga. */
  displayImageUrl: string | null;
  /** URL de cápsula / miniatura: Steam si no hay portada propia; si hay `imageUrl`, la misma portada del usuario. */
  capsuleImage: string | null;
  /** Lista completa de URLs de media disponibles para el juego. */
  mediaUrls: string[];
  /** URL del primer vídeo del juego en Steam, o `null` si no existe. */
  videoUrl: string | null;
  /** Géneros etiquetados por Steam. */
  genres: string[];
  /** Nombre comercial del juego según la Steam Store. */
  steamStoreName: string;
  /** `true` mientras se espera la imagen o los metadatos de Steam. */
  isEffectivelyLoading: boolean;
  /** `true` cuando la imagen ya terminó de cargar en el DOM. */
  imgLoaded: boolean;
  /** `true` si el elemento `<img>` disparó un error de carga. */
  imgError: boolean;
  /** Handler para el evento `onLoad` del elemento `<img>`. */
  handleImgLoad: () => void;
  /** Handler para el evento `onError` del elemento `<img>`. */
  handleImgError: () => void;
  /** URLs de portada en orden de preferencia (para fallback en `<img>`). */
  coverCandidates: string[];
}

/**
 * Construye la lista de URLs de portada a partir del estado resuelto de {@link useGameMedia}.
 */
export function buildGameMediaCoverCandidates(
  game: ConfiguredGame,
  resolvedSteamAppId: string | null | undefined,
  displayImageUrl: string | null,
  mediaUrls: readonly string[],
  capsuleImage: string | null,
  orientation: "vertical" | "horizontal" = "vertical"
): string[] {
  const urls: string[] = [];
  if (displayImageUrl?.trim()) urls.push(displayImageUrl.trim());
  if (capsuleImage?.trim()) urls.push(capsuleImage.trim());
  for (const url of mediaUrls) {
    if (url?.trim()) urls.push(url.trim());
  }

  const appId = getSteamAppId(game, resolvedSteamAppId);
  if (appId) {
    urls.push(...getSteamCdnCandidates(appId, orientation));
  }

  const legacyHeader = getGameImageUrl(game, resolvedSteamAppId);
  const libraryHero = getGameLibraryHeroUrl(game, resolvedSteamAppId);
  if (legacyHeader) urls.push(legacyHeader);
  if (libraryHero) urls.push(libraryHero);

  return [...new Set(urls.filter(Boolean))];
}

/**
 * Obtiene la media (imágenes, vídeo, géneros) de un juego.
 *
 * Estrategia de datos:
 * 1. Si se recibe `mediaBySteamAppId` (batch), se usa directamente y la query
 *    individual queda desactivada.
 * 2. En caso contrario ejecuta una query individual por `steamAppId` (solo si no hay `imageUrl`).
 * 3. Si el juego tiene `imageUrl` personalizada, esa URL es la portada principal y la
 *    cápsula (`capsuleImage`); si además hay datos de Steam (batch o query), se añaden
 *    a `mediaUrls` para la galería/hover sin sustituir la imagen del usuario.
 *
 * @example
 * ```tsx
 * const { displayImageUrl, isEffectivelyLoading } = useGameMedia({ game });
 * ```
 */
export function useGameMedia({
  game,
  resolvedSteamAppId,
  externalLoading = false,
  mediaBySteamAppId,
  mediaFromBatch = false,
  orientation = "vertical",
}: UseGameMediaOptions): UseGameMediaResult {
  const staticImageUrl = getGameImageUrl(game, resolvedSteamAppId);
  const extraImageUrl = getGameLibraryHeroUrl(game, resolvedSteamAppId);
  const steamAppId = getSteamAppId(game, resolvedSteamAppId);

  const hasUserCover = !!game.imageUrl?.trim();

  const { data: appdetailsMedia, isPending: isSteamQueryPending } = useQuery({
    queryKey: ["steam-appdetails-media", steamAppId ?? ""],
    queryFn: () => getSteamAppdetailsMedia(steamAppId!),
    enabled: !!steamAppId && isSteamAppId(steamAppId) && !mediaFromBatch && !hasUserCover,
    staleTime: 5 * 60 * 1000,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnWindowFocus: false,
  });

  /** Fuente final de media: batch tiene prioridad sobre la query individual. */
  const mediaSource = (mediaBySteamAppId && steamAppId ? mediaBySteamAppId[steamAppId] : undefined) ?? appdetailsMedia;

  const { displayImageUrl, mediaUrls, isEffectivelyLoading } = useMemo(() => {
    const isCustomImage = hasUserCover;
    const fallbackDisplay = staticImageUrl ?? "";
    const fallbackUrls = [fallbackDisplay, extraImageUrl].filter(Boolean) as string[];

    // Portada personalizada: prioridad absoluta; galería = usuario + arte Steam si llegó (batch/query).
    if (isCustomImage) {
      const steamExtras = (mediaSource?.mediaUrls ?? []).filter((u: string) => u && u !== fallbackDisplay);
      const merged = [fallbackDisplay, ...steamExtras];
      const deduped = [...new Set(merged)];
      return {
        displayImageUrl: fallbackDisplay,
        mediaUrls: deduped.length > 0 ? deduped : fallbackUrls,
        isEffectivelyLoading: false,
      };
    }

    // Steam tiene media
    if (mediaSource?.mediaUrls?.length) {
      return {
        displayImageUrl: mediaSource.mediaUrls[0],
        mediaUrls: mediaSource.mediaUrls,
        isEffectivelyLoading: false,
      };
    }

    // Determinar si aún estamos esperando datos
    const batchMapMissing = mediaBySteamAppId == null;
    const isWaiting =
      externalLoading ||
      (!!steamAppId && !mediaFromBatch && isSteamQueryPending) ||
      (!!steamAppId && mediaFromBatch && batchMapMissing);

    if (isWaiting) {
      return { displayImageUrl: null, mediaUrls: [], isEffectivelyLoading: true };
    }

    return { displayImageUrl: fallbackDisplay, mediaUrls: fallbackUrls, isEffectivelyLoading: false };
  }, [
    hasUserCover,
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

  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(() => (displayImageUrl ? globalLoadedImages.has(displayImageUrl) : false));

  useEffect(() => {
    setImgError(false);
    if (displayImageUrl && globalLoadedImages.has(displayImageUrl)) {
      setImgLoaded(true);
    } else {
      setImgLoaded(false);
    }
  }, [displayImageUrl]);

  const handleImgLoad = useCallback(() => {
    if (displayImageUrl) globalLoadedImages.add(displayImageUrl);
    setImgLoaded(true);
  }, [displayImageUrl]);

  const handleImgError = useCallback(() => setImgError(true), []);

  const genres = mediaSource?.genres?.filter(Boolean) ?? [];
  const steamStoreName = mediaSource?.name?.trim() ?? "";
  const capsuleImage = hasUserCover
    ? (staticImageUrl ?? mediaSource?.capsuleImage ?? null)
    : (mediaSource?.capsuleImage ?? null);

  const coverCandidates = useMemo(
    () =>
      buildGameMediaCoverCandidates(game, resolvedSteamAppId, displayImageUrl, mediaUrls, capsuleImage, orientation),
    [game, resolvedSteamAppId, displayImageUrl, mediaUrls, capsuleImage, orientation]
  );

  return {
    displayImageUrl,
    capsuleImage,
    mediaUrls,
    videoUrl: mediaSource?.videoUrl ?? null,
    genres,
    steamStoreName,
    isEffectivelyLoading,
    imgLoaded,
    imgError,
    handleImgLoad,
    handleImgError,
    coverCandidates,
  };
}

/**
 * Opciones para {@link useGameMediaBatch}.
 */
interface UseGameMediaBatchOptions {
  /** Lista de juegos para los que se quiere la media. */
  games: readonly ConfiguredGame[];
  /**
   * Mapa de Steam App IDs ya resueltos `gameId → steamAppId`.
   * Normalmente proviene de `useResolvedSteamAppIds`.
   */
  resolvedSteamAppIds: Record<string, string | null | undefined>;
  /**
   * `true` mientras algún juego aún está resolviendo su steamAppId.
   * Evita lanzar el batch antes de tener todos los IDs.
   */
  isResolvingIds: boolean;
}

/**
 * Valor devuelto por {@link useGameMediaBatch}.
 */
export interface UseGameMediaBatchResult {
  /**
   * Mapa `steamAppId → SteamAppdetailsMediaResult` con la media de todos los
   * juegos. `null` mientras la query no ha respondido aún.
   */
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
}

/**
 * Carga en batch la media de Steam para una lista de juegos.
 *
 * Agrupa todos los `steamAppId` en una única petición para reducir la carga
 * de red respecto a N queries individuales.
 *
 * @example
 * ```tsx
 * const { mediaBySteamAppId } = useGameMediaBatch({
 *   games,
 *   resolvedSteamAppIds,
 *   isResolvingIds,
 * });
 * ```
 */
export function useGameMediaBatch({
  games,
  resolvedSteamAppIds,
  isResolvingIds,
}: UseGameMediaBatchOptions): UseGameMediaBatchResult {
  /** IDs únicos y ordenados para una query key estable. */
  const steamAppIdsForBatch = useMemo(() => {
    const ids = games
      .map((g) => getSteamAppId(g, resolvedSteamAppIds[g.id]))
      .filter((id): id is string => !!id && isSteamAppId(id));
    return [...new Set(ids)].sort();
  }, [games, resolvedSteamAppIds]);

  const { data: mediaBySteamAppId = null } = useQuery({
    queryKey: ["steam-appdetails-media-batch", steamAppIdsForBatch.join(",")],
    queryFn: () => getSteamAppdetailsMediaBatch(steamAppIdsForBatch),
    enabled: steamAppIdsForBatch.length > 0 && !isResolvingIds,
    staleTime: 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  return { mediaBySteamAppId };
}

/**
 * Comprueba si algún juego de la lista aún está resolviendo su steamAppId.
 *
 * @param games - Lista de juegos configurados.
 * @param resolvedSteamAppIds - Mapa de IDs ya resueltos.
 * @returns `true` si al menos un juego sigue pendiente de resolución.
 */
export function getIsResolvingIds(
  games: readonly ConfiguredGame[],
  resolvedSteamAppIds: Record<string, string | null | undefined>
): boolean {
  return games.some((game) => needsSteamSearch(game) && resolvedSteamAppIds[game.id] === undefined);
}
