import { useMemo, useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSteamAppdetailsMedia, getSteamAppdetailsMediaBatch } from "@services/tauri";
import { getGameImageUrl, getGameLibraryHeroUrl, getSteamAppId, needsSteamSearch } from "@utils/gameImage";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";

/** Caché global de imágenes ya cargadas en esta sesión, evita re-spinner. */
const globalLoadedImages = new Set<string>();

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
}

/**
 * Valor devuelto por {@link useGameMedia}.
 */
export interface UseGameMediaResult {
  /** URL de la imagen principal a mostrar, o `null` mientras carga. */
  displayImageUrl: string | null;
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
}

/**
 * Obtiene la media (imágenes, vídeo, géneros) de un juego.
 *
 * Estrategia de datos:
 * 1. Si se recibe `mediaBySteamAppId` (batch), se usa directamente y la query
 *    individual queda desactivada.
 * 2. En caso contrario ejecuta una query individual por `steamAppId`.
 * 3. Si el juego tiene `imageUrl` personalizada, se omite Steam por completo.
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
}: UseGameMediaOptions): UseGameMediaResult {
  const staticImageUrl = getGameImageUrl(game, resolvedSteamAppId);
  const extraImageUrl = getGameLibraryHeroUrl(game, resolvedSteamAppId);
  const steamAppId = getSteamAppId(game, resolvedSteamAppId);

  const { data: appdetailsMedia, isPending: isSteamQueryPending } = useQuery({
    queryKey: ["steam-appdetails-media", steamAppId ?? ""],
    queryFn: () => getSteamAppdetailsMedia(steamAppId!),
    enabled: !!steamAppId && !mediaFromBatch,
    staleTime: 5 * 60 * 1000,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnWindowFocus: false,
  });

  /** Fuente final de media: batch tiene prioridad sobre la query individual. */
  const mediaSource = (mediaBySteamAppId && steamAppId ? mediaBySteamAppId[steamAppId] : undefined) ?? appdetailsMedia;

  const { displayImageUrl, mediaUrls, isEffectivelyLoading } = useMemo(() => {
    const isCustomImage = !!game.imageUrl?.trim();
    const fallbackDisplay = staticImageUrl ?? "";
    const fallbackUrls = [fallbackDisplay, extraImageUrl].filter(Boolean) as string[];

    // Imagen personalizada: sin Steam
    if (isCustomImage) {
      return { displayImageUrl: fallbackDisplay, mediaUrls: fallbackUrls, isEffectivelyLoading: false };
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

  return {
    displayImageUrl,
    mediaUrls,
    videoUrl: mediaSource?.videoUrl ?? null,
    genres,
    steamStoreName,
    isEffectivelyLoading,
    imgLoaded,
    imgError,
    handleImgLoad,
    handleImgError,
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
    const ids = games.map((g) => getSteamAppId(g, resolvedSteamAppIds[g.id])).filter((id): id is string => !!id);
    return [...new Set(ids)].sort();
  }, [games, resolvedSteamAppIds]);

  const { data: mediaBySteamAppId = null } = useQuery({
    queryKey: ["steam-appdetails-media-batch", steamAppIdsForBatch.join(",")],
    queryFn: () => getSteamAppdetailsMediaBatch(steamAppIdsForBatch),
    enabled: steamAppIdsForBatch.length > 0 && !isResolvingIds,
    staleTime: 5 * 60 * 1000,
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
