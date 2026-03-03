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
} from "@heroui/react";
import {
  AlertTriangle,
  CloudDownload,
  CloudUpload,
  FolderOpen,
  Gamepad2,
  History,
  MoreVertical,
  Trash2,
} from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { formatGameDisplayName, getGameImageUrl } from "@utils/gameImage";
import { formatBytes, formatRelativeDate } from "@utils/format";

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
}: GameCardProps) {
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imageUrl = getGameImageUrl(game, resolvedSteamAppId);
  const showImage = imageUrl && !imgError;
  const imageLoading = showImage && !imgLoaded;
  const isLoading = externalLoading ?? imageLoading;

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
      isFooterBlurred
      className="group relative overflow-hidden border-none shadow-md transition-all duration-200 ease-out hover:-translate-y-2 hover:shadow-xl"
      radius="lg"
    >
      {isGameRunning && (
        <div
          className="absolute left-2 top-2 z-20 flex items-center gap-1 rounded-md bg-warning/90 px-2 py-1 text-xs font-medium text-warning-foreground backdrop-blur-sm"
          title="El juego está en ejecución. Cierra el juego antes de sincronizar."
        >
          <AlertTriangle size={14} />
          En ejecución
        </div>
      )}
      {(onOpenFolder ||
        onDownload ||
        onSync ||
        onRemove ||
        onRestoreBackup) && (
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
                if (key === "folder") onOpenFolder?.(game);
                else if (key === "download") onDownload?.(game);
                else if (key === "sync") onSync?.(game);
                else if (key === "restore") onRestoreBackup?.(game);
                else if (key === "remove") onRemove?.(game);
              }}
              disabledKeys={
                isDownloading || isSyncing
                  ? ["folder", "download", "sync", "restore"]
                  : isGameRunning
                  ? ["download", "sync", "restore"]
                  : []
              }
            >
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
              {onSync ? (
                <DropdownItem
                  key="sync"
                  startContent={
                    isSyncing ? (
                      <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                      <CloudUpload size={16} className="text-default-500" />
                    )
                  }
                >
                  Subir a la nube
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
      <CardFooter className="absolute bottom-0 left-0 right-0 flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-b-large border-0 bg-black/60 px-3 py-2 backdrop-blur-sm shadow-[0_-4px_20px_rgba(0,0,0,0.4)] z-10">
        <p className="truncate w-full text-center text-xs font-bold uppercase tracking-wider text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
          {formatGameDisplayName(game.id)}
        </p>
        {stats && (
          <p className="w-full truncate text-center text-[10px] text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {formatBytes(stats.localSizeBytes)}
            {stats.localLastModified != null && (
              <> • Local: {formatRelativeDate(stats.localLastModified)}</>
            )}
            {stats.cloudLastModified != null && (
              <> • Nube: {formatRelativeDate(stats.cloudLastModified)}</>
            )}
          </p>
        )}
      </CardFooter>
    </Card>
  );
}
