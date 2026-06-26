import { memo, useCallback, useMemo, startTransition, addTransitionType, ViewTransition } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, CardFooter, Chip, Skeleton, Tooltip } from "@heroui/react";
import { GameCardHoverMotion } from "@features/games/GameCardHoverMotion";
import { Clock, Gamepad2 } from "lucide-react";
import { formatGameDisplayName, getSteamAppId } from "@utils/gameImage";
import { formatBytes, formatPlaytime, formatRelativeDate } from "@utils/format";
import { GameCardHoverCard } from "@features/games/GameCardHoverCard";
import { GameCardStatusBar } from "@features/games/GameCardStatusBar";
import { GameCardSyncProgress } from "@features/games/GameCardSyncProgress";
import { LARGE_GAME_BLOCK_SIZE_BYTES } from "@utils/packageRecommendation";
import { GameCardActions } from "@features/games/GameCardActions";
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

  const {
    displayImageUrl,
    mediaUrls,
    videoUrl,
    genres,
    steamStoreName,
    isEffectivelyLoading,
    imgLoaded,
    imgError,
    handleImgLoad,
    handleImgError,
  } = useGameMedia({
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
      <Card isFooterBlurred className="overflow-hidden border-none shadow-md" radius="lg">
        <Skeleton className="aspect-460/215 w-full rounded-t-large" />
        <CardFooter className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-black/60 px-3 py-2 backdrop-blur-sm z-10">
          <Skeleton className="h-3 w-3/4 rounded-lg bg-white/30" />
        </CardFooter>
      </Card>
    );
  }

  const cardContent = (
    <GameCardHoverMotion disableMotion={isCatalog}>
      <div
        className="cursor-pointer relative"
        onClick={handleCardClick}
        onMouseEnter={onHoverStart}
        onMouseLeave={onHoverEnd}
        role="link"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && handleCardClick()}>
        <Card
          className="relative overflow-hidden border-none shadow-nonesubpixel-antialiased transform-gpu"
          radius="lg">
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

          <MaybeViewTransition name={`game-hero-${game.id}`} share="hero-morph" disabled={isLowPerf}>
            <div className="relative aspect-460/215 w-full overflow-hidden rounded-t-large bg-default-100">
              {(isEffectivelyLoading || (displayImageUrl && !imgLoaded && !imgError)) && (
                <Skeleton className="absolute inset-0 z-10 size-full" />
              )}

              {displayImageUrl && !imgError ? (
                <img
                  key={displayImageUrl}
                  src={displayImageUrl}
                  loading="lazy"
                  decoding="async"
                  fetchPriority="auto"
                  draggable={false}
                  alt={game.id}
                  className={`size-full object-cover object-center transition-opacity duration-300 subpixel-antialiased transform-gpu ${
                    imgLoaded ? "opacity-100" : "opacity-0"
                  }`}
                  onLoad={handleImgLoad}
                  onError={handleImgError}
                />
              ) : (
                !isEffectivelyLoading && (
                  <div className="flex size-full items-center justify-center">
                    <Gamepad2 size={48} className="text-default-400" strokeWidth={1.5} />
                  </div>
                )
              )}
            </div>
          </MaybeViewTransition>

          <CardFooter className="flex flex-col items-center justify-center gap-0.5 border-t border-default-200/80 bg-default-100 px-3 py-2 dark:bg-default-50/80">
            <p className="truncate w-full text-center text-xs font-bold uppercase tracking-wider text-foreground">
              {cardTitle ?? formatGameDisplayName(game.id)}
            </p>
            {genres.length > 0 && (
              <div className="flex max-w-full flex-wrap justify-center gap-0.5">
                {genres.slice(0, 3).map((g, i) => (
                  <Chip
                    key={`${g}-${i}`}
                    size="sm"
                    variant="flat"
                    className="h-4 min-h-4 max-w-28 truncate px-1 py-0 text-[9px]">
                    {g}
                  </Chip>
                ))}
              </div>
            )}

            {!isCatalog && (
              <GameCardStatusBar
                isGameRunning={isGameRunning}
                syncStatus={syncStatus}
                cloudBackupCount={cloudBackupCount}
              />
            )}

            {!isCatalog && isUploadTooLarge && cardRest.onFullBackupUpload && (
              <Tooltip content="Demasiado grande: usa Empaquetar." placement="top">
                <span className="mt-0.5 inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning text-center">
                  Requiere empaquetar
                </span>
              </Tooltip>
            )}

            {!isCatalog && (
              <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-center gap-1 bg-black/60 px-3 py-2 backdrop-blur-md opacity-0 transition-opacity duration-150 group-hover:opacity-100 z-20">
                {stats && (
                  <>
                    <p className="w-full truncate text-center text-[10px] text-white font-medium">
                      <span className="text-white/60">Guardado:</span> {formatBytes(stats.localSizeBytes)}
                    </p>

                    {stats.localLastModified != null && (
                      <p className="w-full truncate text-center text-[10px] text-white font-medium">
                        <span className="text-white/60">Última vez:</span> {formatRelativeDate(stats.localLastModified)}
                      </p>
                    )}

                    <div className="flex items-center gap-1 text-warning">
                      <Clock size={10} />
                      <span className="text-[10px] font-bold">{formatPlaytime(stats.playtimeSeconds)}</span>
                      <span className="text-[10px] text-white/60">jugado</span>
                    </div>
                  </>
                )}

                {game.editionLabel && (
                  <p className="w-full truncate text-center text-[10px] text-white/70">{game.editionLabel}</p>
                )}
              </div>
            )}
          </CardFooter>
        </Card>
      </div>
    </GameCardHoverMotion>
  );

  return (
    <GameCardHoverCard
      game={game}
      mediaUrls={mediaUrls}
      videoUrl={videoUrl}
      genres={genres}
      storeName={steamStoreName || undefined}
      stats={stats}>
      {cardContent}
    </GameCardHoverCard>
  );
});
