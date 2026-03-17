import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardFooter, Skeleton, Tooltip } from "@heroui/react";
import { GameCardHoverMotion } from "@features/games/GameCardHoverMotion";
import { Gamepad2 } from "lucide-react";
import { getSteamAppdetailsMedia } from "@services/tauri";
import { formatGameDisplayName, getGameImageUrl, getGameLibraryHeroUrl, getSteamAppId } from "@utils/gameImage";
import { formatBytes, formatRelativeDate } from "@utils/format";
import { GameCardHoverCard } from "@features/games/GameCardHoverCard";
import { GameCardStatusBar } from "@features/games/GameCardStatusBar";
import { GameCardSyncProgress } from "@features/games/GameCardSyncProgress";
import { LARGE_GAME_BLOCK_SIZE_BYTES } from "@utils/packageRecommendation";
import { GameCardActions } from "@features/games/GameCardActions";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import type { SyncProgressState } from "@contexts/SyncProgressContext";
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
  /** Callback al descargar el juego. Si no se pasa, no se muestra el botón. */
  onDownload?: (game: ConfiguredGame) => void;
  /** Muestra spinner en el botón de descargar. */
  isDownloading?: boolean;
  /** Callback al abrir la carpeta de guardados. Si no se pasa, no se muestra el botón. */
  onOpenFolder?: (game: ConfiguredGame) => void;
  /** Callback para restaurar desde backup. */
  onRestoreBackup?: (game: ConfiguredGame) => void;
  /** Callback para empaquetar y subir (backup completo en la nube). */
  onFullBackupUpload?: (game: ConfiguredGame) => void;
  /** Muestra spinner en empaquetar y subir. */
  isFullBackupUploading?: boolean;
  /** Callback para editar el juego. Si no se pasa, no se muestra el botón. */
  onEdit?: (game: ConfiguredGame) => void;
  /** Callback para compartir por link (genera URL y copia al portapapeles). */
  onShare?: (game: ConfiguredGame) => void;
  /** Estado de sincronización con la nube (para mostrar badge). */
  syncStatus?: "pending_upload" | "pending_download" | "in_sync" | null;
  /** Número de backups completos (empaquetados) en la nube para este juego. Se muestra un badge si > 0. */
  cloudBackupCount?: number;
  /** Progreso de subida/descarga de un solo juego (muestra barra inline en la tarjeta). */
  syncProgress?: SyncProgressState | null;
  /** Medios por Steam App ID (de una petición batch). Si se pasa, no se hace useQuery individual. */
  mediaBySteamAppId?: Record<string, SteamAppdetailsMediaResult> | null;
  /** Si true, los medios vienen solo del batch (no hacer useQuery individual aunque el batch siga cargando). */
  mediaFromBatch?: boolean;
}

export function GameCard(props: GameCardProps) {
  const {
    game,
    stats,
    isGameRunning,
    resolvedSteamAppId,
    isLoading: externalLoading,
    syncStatus,
    cloudBackupCount = 0,
    syncProgress,
    mediaBySteamAppId,
    mediaFromBatch = false,
  } = props;

  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const imageUrl = getGameImageUrl(game, resolvedSteamAppId);
  const extraImageUrl = getGameLibraryHeroUrl(game, resolvedSteamAppId);
  const steamAppId = getSteamAppId(game, resolvedSteamAppId);

  const { data: appdetailsMedia } = useQuery({
    queryKey: ["steam-appdetails-media", steamAppId ?? ""],
    queryFn: () => getSteamAppdetailsMedia(steamAppId!),
    enabled: !!steamAppId && !mediaFromBatch,
    staleTime: 5 * 60 * 1000,
  });

  const mediaSource = (mediaBySteamAppId && steamAppId ? mediaBySteamAppId[steamAppId] : undefined) ?? appdetailsMedia;
  const mediaUrls = useMemo(() => {
    if (mediaSource?.mediaUrls?.length) return mediaSource.mediaUrls;
    return [imageUrl, extraImageUrl].filter(Boolean) as string[];
  }, [mediaSource?.mediaUrls, imageUrl, extraImageUrl]);

  const isUploadTooLarge = (stats?.localSizeBytes ?? 0) >= LARGE_GAME_BLOCK_SIZE_BYTES;
  const isLoading = externalLoading ?? (imageUrl && !imgError && !imgLoaded);

  if (isLoading) {
    return (
      <Card isFooterBlurred className="overflow-hidden border-none shadow-md" radius="lg">
        <Skeleton className="aspect-460/215 w-full rounded-t-large" />
        <CardFooter className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-black/60 px-3 py-2 backdrop-blur-sm z-10">
          <Skeleton className="h-3 w-3/4 rounded-lg bg-white/30" />
        </CardFooter>
      </Card>
    );
  }

  return (
    <GameCardHoverCard game={game} mediaUrls={mediaUrls} videoUrl={mediaSource?.videoUrl ?? null} stats={stats}>
      <GameCardHoverMotion>
        <Card className="group relative overflow-hidden border-none shadow-none" radius="lg">
          <GameCardActions {...props} isUploadTooLarge={isUploadTooLarge} />

          {syncProgress && syncProgress.total > 0 && <GameCardSyncProgress progress={syncProgress} />}

          <div className="relative aspect-460/215 w-full overflow-hidden rounded-t-large bg-default-100">
            {imageUrl && !imgError ? (
              <img
                src={imageUrl}
                alt={game.id}
                className="size-full object-cover object-center"
                onLoad={() => setImgLoaded(true)}
                onError={() => setImgError(true)}
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <Gamepad2 size={48} className="text-default-400" strokeWidth={1.5} />
              </div>
            )}
          </div>

          <CardFooter className="flex flex-col items-center justify-center gap-0.5 border-t border-default-200/80 bg-default-100 px-3 py-2 dark:bg-default-50/80">
            <p className="truncate w-full text-center text-xs font-bold uppercase tracking-wider text-foreground">
              {formatGameDisplayName(game.id)}
            </p>

            <GameCardStatusBar
              isGameRunning={isGameRunning}
              syncStatus={syncStatus}
              cloudBackupCount={cloudBackupCount}
            />

            {isUploadTooLarge && props.onFullBackupUpload && (
              <Tooltip content="Demasiado grande: usa Empaquetar." placement="top">
                <span className="mt-0.5 inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning text-center">
                  Requiere empaquetar
                </span>
              </Tooltip>
            )}

            <div className="absolute inset-x-0 bottom-0 flex flex-col items-center justify-center gap-1 bg-black/40 px-3 py-2 backdrop-blur-sm opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {stats && (
                <p className="w-full truncate text-center text-[10px] text-white">
                  {formatBytes(stats.localSizeBytes)}
                  {stats.localLastModified != null && <> · Local: {formatRelativeDate(stats.localLastModified)}</>}
                </p>
              )}

              {game.editionLabel && (
                <p className="w-full truncate text-center text-[10px] text-white/80">Origen: {game.editionLabel}</p>
              )}
            </div>
          </CardFooter>
        </Card>
      </GameCardHoverMotion>
    </GameCardHoverCard>
  );
}
