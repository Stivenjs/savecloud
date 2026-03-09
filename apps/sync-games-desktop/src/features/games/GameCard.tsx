import { useState } from "react";
import {
  Button,
  Card,
  CardFooter,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Skeleton,
  Tooltip,
} from "@heroui/react";
import {
  Archive,
  CloudDownload,
  CloudUpload,
  FolderOpen,
  Gamepad2,
  History,
  Link2,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import type { SyncProgressState } from "@components/layout";
import { formatGameDisplayName, getGameImageUrl } from "@utils/gameImage";
import { formatBytes, formatRelativeDate } from "@utils/format";
import { GameCardStatusBar } from "@features/games/GameCardStatusBar";
import { GameCardSyncProgress } from "@features/games/GameCardSyncProgress";
import { LARGE_GAME_BLOCK_SIZE_BYTES } from "@utils/packageRecommendation";

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
}

/**
 * Tarjeta de juego con portada, usando HeroUI.
 * La imagen mantiene la proporción correcta de Steam (460×215) sin distorsión.
 * Muestra skeletons de HeroUI mientras carga.
 */
export function GameCard({
  game,
  stats,
  isGameRunning,
  resolvedSteamAppId,
  isLoading: externalLoading,
  onRemove,
  onSync,
  isSyncing,
  onDownload,
  isDownloading,
  onOpenFolder,
  onRestoreBackup,
  onFullBackupUpload,
  isFullBackupUploading,
  onEdit,
  onShare,
  syncStatus,
  cloudBackupCount = 0,
  syncProgress,
}: GameCardProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imageUrl = getGameImageUrl(game, resolvedSteamAppId);
  const showImage = imageUrl && !imgError;
  const imageLoading = showImage && !imgLoaded;
  const isLoading = externalLoading ?? imageLoading;
  const isUploadTooLarge =
    (stats?.localSizeBytes ?? 0) >= LARGE_GAME_BLOCK_SIZE_BYTES;
  const showPackageRequiredChip = isUploadTooLarge && !!onFullBackupUpload;
  const uploadTooLargeTooltip = "Demasiado grande: usa Empaquetar y subir.";

  if (isLoading) {
    return (
      <Card
        isFooterBlurred
        className="overflow-hidden border-none shadow-md"
        radius="lg"
      >
        <Skeleton className="aspect-460/215 w-full rounded-t-large" />
        <CardFooter className="absolute bottom-0 left-0 right-0 flex items-center justify-center overflow-hidden rounded-b-large border-0 bg-black/60 px-3 py-2 backdrop-blur-sm shadow-[0_-4px_20px_rgba(0,0,0,0.4)] z-10">
          <Skeleton className="h-3 w-3/4 rounded-lg bg-white/30" />
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card
      className="group relative overflow-hidden border-none shadow-md transition-all duration-200 ease-out hover:-translate-y-2 hover:shadow-xl"
      radius="lg"
    >
      {(onOpenFolder ||
        onDownload ||
        onSync ||
        onFullBackupUpload ||
        onRemove ||
        onRestoreBackup ||
        onEdit ||
        onShare) && (
        <div
          className="absolute right-2 top-2 z-20"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <Button
                isIconOnly
                size="sm"
                variant="flat"
                className="min-w-unit-9 h-9 rounded-lg bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-default-100 hover:opacity-100 focus:opacity-100 group-hover:opacity-100 data-hover:opacity-100"
                aria-label={`Acciones de ${game.id}`}
              >
                <MoreVertical size={18} strokeWidth={2} />
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label={`Acciones de ${game.id}`}
              onAction={(key) => {
                if (key === "edit") onEdit?.(game);
                else if (key === "folder") onOpenFolder?.(game);
                else if (key === "download") onDownload?.(game);
                else if (key === "sync") {
                  if (isUploadTooLarge) return;
                  onSync?.(game);
                } else if (key === "fullBackup") onFullBackupUpload?.(game);
                else if (key === "restore") onRestoreBackup?.(game);
                else if (key === "share") onShare?.(game);
                else if (key === "remove") onRemove?.(game);
              }}
              disabledKeys={
                isDownloading || isSyncing || isFullBackupUploading
                  ? ["folder", "download", "sync", "fullBackup", "restore"]
                  : isGameRunning
                  ? ["download", "sync", "fullBackup", "restore"]
                  : []
              }
            >
              {onEdit ? (
                <DropdownItem
                  key="edit"
                  startContent={
                    <Pencil size={16} className="text-default-500" />
                  }
                >
                  Editar juego
                </DropdownItem>
              ) : null}
              {onOpenFolder ? (
                <DropdownItem
                  key="folder"
                  startContent={
                    <FolderOpen size={16} className="text-default-500" />
                  }
                >
                  Abrir carpeta de guardados
                </DropdownItem>
              ) : null}
              {onDownload ? (
                <DropdownItem
                  key="download"
                  startContent={
                    isDownloading ? (
                      <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <CloudDownload size={16} className="text-default-500" />
                    )
                  }
                >
                  Descargar desde la nube
                </DropdownItem>
              ) : null}
              {onRestoreBackup ? (
                <DropdownItem
                  key="restore"
                  startContent={
                    <History size={16} className="text-default-500" />
                  }
                >
                  Restaurar desde backup
                </DropdownItem>
              ) : null}
              {onShare ? (
                <DropdownItem
                  key="share"
                  startContent={
                    <Link2 size={16} className="text-default-500" />
                  }
                >
                  Compartir por link
                </DropdownItem>
              ) : null}
              {onFullBackupUpload ? (
                <DropdownItem
                  key="fullBackup"
                  className={isUploadTooLarge ? "text-warning" : undefined}
                  startContent={
                    isFullBackupUploading ? (
                      <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <Archive
                        size={16}
                        className={
                          isUploadTooLarge ? "text-warning" : "text-default-500"
                        }
                      />
                    )
                  }
                >
                  {isUploadTooLarge
                    ? "Empaquetar y subir (obligatorio)"
                    : "Empaquetar y subir (backup completo)"}
                </DropdownItem>
              ) : null}
              {onSync ? (
                <DropdownItem
                  key="sync"
                  className={
                    isUploadTooLarge
                      ? "cursor-not-allowed opacity-60"
                      : undefined
                  }
                  startContent={
                    isSyncing ? (
                      <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <CloudUpload
                        size={16}
                        className={
                          isUploadTooLarge ? "text-warning" : "text-default-500"
                        }
                      />
                    )
                  }
                >
                  {isUploadTooLarge ? (
                    <Tooltip content={uploadTooLargeTooltip} placement="left">
                      <span>Subir a la nube (no disponible)</span>
                    </Tooltip>
                  ) : (
                    "Subir a la nube"
                  )}
                </DropdownItem>
              ) : null}
              {onRemove ? (
                <DropdownItem
                  key="remove"
                  className="text-danger"
                  color="danger"
                  startContent={<Trash2 size={16} className="text-danger" />}
                >
                  Eliminar juego
                </DropdownItem>
              ) : null}
            </DropdownMenu>
          </Dropdown>
        </div>
      )}
      {syncProgress && syncProgress.total > 0 && (
        <GameCardSyncProgress progress={syncProgress} />
      )}
      {showImage ? (
        <div className="relative aspect-460/215 w-full overflow-hidden rounded-t-large">
          <img
            src={imageUrl}
            alt={`Portada de ${game.id}`}
            className="size-full object-cover object-center"
            loading="lazy"
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        </div>
      ) : (
        <div className="flex aspect-460/215 w-full items-center justify-center rounded-t-large bg-default-100">
          <Gamepad2 size={48} className="text-default-400" strokeWidth={1.5} />
        </div>
      )}
      <CardFooter className="flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-b-large rounded-t-none border-0 border-t border-default-200/80 bg-default-100 px-3 py-2 dark:bg-default-50/80">
        <p className="truncate w-full text-center text-xs font-bold uppercase tracking-wider text-foreground">
          {formatGameDisplayName(game.id)}
        </p>
        <GameCardStatusBar
          isGameRunning={isGameRunning}
          syncStatus={syncStatus}
          cloudBackupCount={cloudBackupCount}
        />
        {showPackageRequiredChip && (
          <Tooltip content={uploadTooLargeTooltip} placement="top">
            <span className="mt-0.5 inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
              Requiere empaquetar
            </span>
          </Tooltip>
        )}
        {stats && (
          <p className="w-full truncate text-center text-[10px] text-default-600">
            {formatBytes(stats.localSizeBytes)}
            {stats.localLastModified != null && (
              <> · Local: {formatRelativeDate(stats.localLastModified)}</>
            )}
            {stats.cloudLastModified != null && (
              <> · Nube: {formatRelativeDate(stats.cloudLastModified)}</>
            )}
          </p>
        )}
        {(game.editionLabel || game.sourceUrl) && (
          <p className="w-full truncate text-center text-[10px] text-default-500">
            {game.editionLabel && <>Origen: {game.editionLabel}</>}
            {game.editionLabel && game.sourceUrl && " · "}
            {game.sourceUrl && (
              <a
                href={game.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:opacity-80"
              >
                Ver enlace
              </a>
            )}
          </p>
        )}
      </CardFooter>
    </Card>
  );
}
