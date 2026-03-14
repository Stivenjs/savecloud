import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from "@heroui/react";
import {
  Archive,
  CloudDownload,
  CloudUpload,
  FolderOpen,
  History,
  Link2,
  MoreVertical,
  Pencil,
  Trash2,
  ExternalLink,
} from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface GameCardActionsProps {
  game: ConfiguredGame;
  isGameRunning?: boolean;
  isUploadTooLarge?: boolean;
  isSyncing?: boolean;
  isDownloading?: boolean;
  isFullBackupUploading?: boolean;
  onRemove?: (game: ConfiguredGame) => void;
  onSync?: (game: ConfiguredGame) => void;
  onDownload?: (game: ConfiguredGame) => void;
  onOpenFolder?: (game: ConfiguredGame) => void;
  onRestoreBackup?: (game: ConfiguredGame) => void;
  onFullBackupUpload?: (game: ConfiguredGame) => void;
  onEdit?: (game: ConfiguredGame) => void;
  onShare?: (game: ConfiguredGame) => void;
}

export function GameCardActions({
  game,
  isGameRunning,
  isUploadTooLarge,
  isSyncing,
  isDownloading,
  isFullBackupUploading,
  onRemove,
  onSync,
  onDownload,
  onOpenFolder,
  onRestoreBackup,
  onFullBackupUpload,
  onEdit,
  onShare,
}: GameCardActionsProps) {
  const handleAction = async (key: React.Key) => {
    const action = String(key);

    switch (action) {
      case "edit":
        onEdit?.(game);
        break;
      case "folder":
        onOpenFolder?.(game);
        break;
      case "download":
        onDownload?.(game);
        break;
      case "restore":
        onRestoreBackup?.(game);
        break;
      case "share":
        onShare?.(game);
        break;
      case "fullBackup":
        onFullBackupUpload?.(game);
        break;
      case "remove":
        onRemove?.(game);
        break;
      case "source":
        if (game.sourceUrl) await openUrl(game.sourceUrl);
        break;
      case "sync":
        if (!isUploadTooLarge) onSync?.(game);
        break;
    }
  };

  const disabledKeys =
    isDownloading || isSyncing || isFullBackupUploading
      ? ["folder", "download", "sync", "fullBackup", "restore"]
      : isGameRunning
        ? ["download", "sync", "fullBackup", "restore"]
        : [];

  return (
    <div className="absolute right-2 top-2 z-20" onClick={(e) => e.stopPropagation()}>
      <Dropdown placement="bottom-end">
        <DropdownTrigger>
          <Button
            isIconOnly
            size="sm"
            variant="flat"
            className="min-w-unit-9 h-9 rounded-lg bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus:opacity-100"
            aria-label="Acciones">
            <MoreVertical size={18} />
          </Button>
        </DropdownTrigger>
        <DropdownMenu aria-label={`Acciones para ${game.id}`} onAction={handleAction} disabledKeys={disabledKeys}>
          <DropdownItem key="edit" className={!onEdit ? "hidden" : ""} startContent={<Pencil size={16} />}>
            Editar juego
          </DropdownItem>

          <DropdownItem
            key="source"
            className={!game.sourceUrl ? "hidden" : "text-primary"}
            startContent={<ExternalLink size={16} />}>
            Ir a la web del juego
          </DropdownItem>

          <DropdownItem key="folder" className={!onOpenFolder ? "hidden" : ""} startContent={<FolderOpen size={16} />}>
            Abrir carpeta de guardados
          </DropdownItem>

          <DropdownItem
            key="download"
            className={!onDownload ? "hidden" : ""}
            startContent={
              isDownloading ? (
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <CloudDownload size={16} />
              )
            }>
            Descargar de la nube
          </DropdownItem>

          <DropdownItem
            key="sync"
            className={!onSync || isUploadTooLarge ? "hidden" : ""}
            startContent={<CloudUpload size={16} />}>
            Subir a la nube
          </DropdownItem>

          <DropdownItem
            key="fullBackup"
            className={!onFullBackupUpload ? "hidden" : isUploadTooLarge ? "text-warning" : ""}
            startContent={
              isFullBackupUploading ? (
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Archive size={16} />
              )
            }>
            {isUploadTooLarge ? "Empaquetar y subir (obligatorio)" : "Empaquetar y subir"}
          </DropdownItem>

          <DropdownItem key="restore" className={!onRestoreBackup ? "hidden" : ""} startContent={<History size={16} />}>
            Restaurar backup
          </DropdownItem>

          <DropdownItem key="share" className={!onShare ? "hidden" : ""} startContent={<Link2 size={16} />}>
            Compartir link
          </DropdownItem>

          <DropdownItem
            key="remove"
            className={!onRemove ? "hidden" : "text-danger"}
            color="danger"
            startContent={<Trash2 size={16} />}>
            Eliminar juego
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>
    </div>
  );
}
