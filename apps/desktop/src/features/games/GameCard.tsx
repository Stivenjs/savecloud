import { memo, useCallback, useMemo, startTransition, addTransitionType, ViewTransition } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Skeleton } from "@heroui/react";
import { GameCardHoverMotion } from "@features/games/GameCardHoverMotion";
import { formatGameDisplayName, getSteamAppId } from "@utils/gameImage";
import { GameCardHoverCard } from "@features/games/GameCardHoverCard";
import { GameCardSyncProgress } from "@features/games/GameCardSyncProgress";
import { LARGE_GAME_BLOCK_SIZE_BYTES } from "@utils/packageRecommendation";
import { GameCardActions } from "@features/games/GameCardActions";
import { GameCardSyncBadge } from "@features/games/GameCardSyncBadge";
import { GameCardStatsPanel } from "@features/games/GameCardStatsPanel";
import { CatalogCoverImage } from "@features/steam-catalog/components/CatalogCoverImage";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";
import { useGameMedia } from "@hooks/useGameMedia";
import { useSyncStore } from "@store/SyncStore";
import { useGameDetailHoverPrefetch } from "@hooks/useGameDetailHoverPrefetch";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import type { SteamAppdetailsMediaResult } from "@services/tauri";

export interface GameCardProps {
  game: ConfiguredGame;
  /** Estadísticas del juego (tamaño, últimas modificaciones). Opcional. */
  stats?: GameStats | null;
  /** Si el juego está en ejecución (mostrar advertencia, deshabilitar sync/download). */
  isGameRunning?: boolean;
  /** Steam App ID resuelto dinámicamente (por búsqueda). Opcional. */
  resolvedSteamAppId?: string | null;
  /** Muestra skeleton mientras se resuelve Steam ID o carga la imagen. */
  isLoading?: boolean;
  /** Callback al eliminar el juego. Si no se pasa, no se muestra el botón. */
  onRemove?: (game: ConfiguredGame) => void;
  /** Callback al sincronizar (subir) el juego. Si no se pasa, no se muestra el botón. */
  onSync?: (game: ConfiguredGame) => void;
  /** Muestra spinner en el botón de sincronizar. */
  isSyncing?: boolean;
  /** Muestra spinner en Traer guardados cuando hay descarga en curso para esta tarjeta. */
  isDownloading?: boolean;
  /** Callback al abrir la carpeta de guardados. Si no se pasa, no se muestra el botón. */
  onOpenFolder?: (game: ConfiguredGame) => void;
  /** Abre el modal Traer guardados (nube + copias locales + snapshots). */
  onRecoverFromCloud?: (game: ConfiguredGame) => void;
  /** Callback para empaquetar y subir (backup completo en la nube). */
  onFullBackupUpload?: (game: ConfiguredGame) => void;
  /** Muestra spinner en empaquetar y subir. */
  isFullBackupUploading?: boolean;
  /** Callback para editar el juego. Si no se pasa, no se muestra el botón. */
  onEdit?: (game: ConfiguredGame) => void;
  /** Callback para abrir el panel de torrent. */
  onTorrent?: (game: ConfiguredGame) => void;
  /** Callback para compartir por link (genera URL y copia al portapapeles). */
  onShare?: (game: ConfiguredGame) => void;
  /** Estado de sincronización con la nube (para mostrar badge). */
  syncStatus?: "pending_upload" | "pending_download" | "in_sync" | null;
  /** Número de backups completos (empaquetados) en la nube para este juego. Se muestra un badge si > 0. */
  cloudBackupCount?: number;
  /** Progreso de subida/descarga de un solo juego (muestra barra inline en la tarjeta). */
  /** Medios por Steam App ID (de una petición batch). Si se pasa, no se hace useQuery individual. */
  mediaBySteamAppId?: Record<string, SteamAppdetailsMediaResult> | null;
  /** Si true, los medios vienen solo del batch (no hacer useQuery individual aunque el batch siga cargando). */
  mediaFromBatch?: boolean;
  /** Control del menú de acciones: un solo desplegable abierto en listas con muchas tarjetas. */
  actionsMenuOpen?: boolean;
  /** Callback estable desde la lista; incluye gameId para no crear closures por tarjeta en cada render. */
  onActionsMenuOpenChange?: (isOpen: boolean, gameId: string) => void;
  /** Título del pie de tarjeta (si no, se deriva de `game.id`). Útil para catálogo Steam con nombre oficial. */
  cardTitle?: string;
  /** Navegación al pulsar la tarjeta; por defecto va a `/games/:id`. */
  onCardNavigate?: (game: ConfiguredGame) => void;
  /** `catalog`: sin menú ni barra de sync; sin tilt/sombra ni overlay de stats del pie; el desplegable de medios (imágenes/vídeo) se mantiene. */
  variant?: "library" | "catalog";
}

function MaybeViewTransition({
  name,
  share,
  disabled,
  children,
}: {
  name: string;
  share?: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) return <>{children}</>;
  return (
    <ViewTransition name={name} share={share} default="none">
      {children}
    </ViewTransition>
  );
}

export const GameCard = memo(function GameCard(props: GameCardProps) {
  const isLowPerf = useLowPerformanceMode();
  const {
    game,
    stats,
    isGameRunning,
    resolvedSteamAppId,
    isLoading: externalLoading,
    syncStatus,
    cloudBackupCount = 0,
    mediaBySteamAppId,
    mediaFromBatch = false,
    onActionsMenuOpenChange: onActionsMenuFromParent,
    cardTitle,
    onCardNavigate,
    variant = "library",
    ...cardRest
  } = props;

  const isCatalog = variant === "catalog";

  const syncProgress = useSyncStore((state) => {
    if (state.syncOperation?.mode === "single" && state.syncOperation.gameId === game.id) {
      return state.progress;
    }
    return null;
  });

  const { mediaUrls, videoUrl, genres, steamStoreName, isEffectivelyLoading, coverCandidates } = useGameMedia({
    game,
    resolvedSteamAppId,
    externalLoading,
    mediaBySteamAppId,
    mediaFromBatch,
  });

  const navigate = useNavigate();
  const location = useLocation();

  const steamAppId = useMemo(() => getSteamAppId(game, resolvedSteamAppId), [game, resolvedSteamAppId]);
  const { onHoverStart, onHoverEnd } = useGameDetailHoverPrefetch(steamAppId);

  const handleCardClick = useCallback(() => {
    if (onCardNavigate) {
      onCardNavigate(game);
      return;
    }
    if (isLowPerf) {
      navigate(`/games/${game.id}`, {
        state: { resolvedSteamAppId, from: `${location.pathname}${location.search}` },
      });
      return;
    }
    startTransition(() => {
      addTransitionType("game-detail");
      navigate(`/games/${game.id}`, {
        state: { resolvedSteamAppId, from: `${location.pathname}${location.search}` },
      });
    });
  }, [navigate, game, location.pathname, location.search, onCardNavigate, resolvedSteamAppId, isLowPerf]);

  const isUploadTooLarge = (stats?.localSizeBytes ?? 0) >= LARGE_GAME_BLOCK_SIZE_BYTES;

  const handleActionsMenuOpenChange = useCallback(
    (open: boolean) => {
      onActionsMenuFromParent?.(open, game.id);
    },
    [game.id, onActionsMenuFromParent]
  );

  if (externalLoading) {
    return (
      <div className="border border-zinc-800/80 shadow-md overflow-hidden bg-[#0e0f14] rounded-xl">
        <Skeleton className="aspect-460/215 w-full bg-zinc-800 rounded-xl" />
      </div>
    );
  }

  const cardContent = (
    <GameCardHoverMotion disableMotion={isCatalog}>
      <div
        className="cursor-pointer relative bg-[#0e0f14] border border-zinc-800/80 hover:border-zinc-700 shadow-md transition-colors duration-300 overflow-hidden rounded-xl aspect-460/215 w-full group/card"
        onClick={handleCardClick}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleCardClick()}>
        {!isCatalog && (
          <GameCardActions
            {...cardRest}
            game={game}
            isGameRunning={isGameRunning}
            isUploadTooLarge={isUploadTooLarge}
            onActionsMenuOpenChange={onActionsMenuFromParent ? handleActionsMenuOpenChange : undefined}
          />
        )}

        {!isCatalog && syncProgress && <GameCardSyncProgress progress={syncProgress} />}

        <MaybeViewTransition name={`game-hero-${game.id}`} share="hero-morph" disabled={isLowPerf || isCatalog}>
          <div className="relative size-full overflow-hidden bg-zinc-950 rounded-xl">
            {isEffectivelyLoading ? (
              <Skeleton className="absolute inset-0 z-10 size-full rounded-xl" />
            ) : (
              <CatalogCoverImage
                alt={game.id}
                candidates={coverCandidates}
                fallbackTitle={cardTitle ?? formatGameDisplayName(game.id)}
                className="size-full object-cover object-center transition-[transform,opacity] duration-200 ease-out group-hover:scale-[1.02] subpixel-antialiased transform-gpu rounded-xl"
                showSkeleton={!isCatalog}
              />
            )}
            {/* Soft bottom shading to integrate image with card background */}
            <div className="absolute inset-0 bg-linear-to-t from-[#0e0f14]/90 via-transparent to-transparent pointer-events-none z-10" />
            <GameCardSyncBadge
              gameId={game.id}
              syncStatus={syncStatus}
              isGameRunning={isGameRunning}
              cloudBackupCount={cloudBackupCount}
              localSizeBytes={stats?.localSizeBytes}
            />
          </div>
        </MaybeViewTransition>

        {/* Sliding detailed stats panel */}
        {!isCatalog && stats && <GameCardStatsPanel stats={stats} editionLabel={game.editionLabel} />}
      </div>
    </GameCardHoverMotion>
  );

  return (
    <GameCardHoverCard
      game={game}
      variant={variant}
      mediaUrls={mediaUrls}
      videoUrl={videoUrl}
      genres={genres}
      storeName={steamStoreName || undefined}
      stats={stats}>
      {cardContent}
    </GameCardHoverCard>
  );
});
