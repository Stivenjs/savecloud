import { Button, Dropdown, DropdownTrigger } from "@heroui/react";
import { MoreVertical } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { GameActionsDropdownMenu } from "@features/games/game-actions";

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
  onTorrent?: (game: ConfiguredGame) => void;
  onShare?: (game: ConfiguredGame) => void;
  actionsMenuOpen?: boolean;
  onActionsMenuOpenChange?: (isOpen: boolean) => void;
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
  onTorrent,
  onShare,
  actionsMenuOpen,
  onActionsMenuOpenChange,
}: GameCardActionsProps) {
  const controlledMenu =
    onActionsMenuOpenChange != null ? { isOpen: actionsMenuOpen ?? false, onOpenChange: onActionsMenuOpenChange } : {};

  return (
    <div className="absolute right-2 top-2 z-20" onClick={(e) => e.stopPropagation()}>
      <Dropdown placement="bottom-end" {...controlledMenu}>
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
        <GameActionsDropdownMenu
          surface="list"
          game={game}
          isGameRunning={isGameRunning}
          isUploadTooLarge={isUploadTooLarge}
          isSyncing={isSyncing}
          isDownloading={isDownloading}
          isFullBackupUploading={isFullBackupUploading}
          onEdit={onEdit}
          onTorrent={onTorrent}
          onOpenFolder={onOpenFolder}
          onSync={onSync}
          onDownload={onDownload}
          onFullBackupUpload={onFullBackupUpload}
          onRestoreBackup={onRestoreBackup}
          onShare={onShare}
          onRemove={onRemove}
        />
      </Dropdown>
    </div>
  );
}
