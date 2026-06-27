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
  onOpenFolder?: (game: ConfiguredGame) => void;
  /** Abre el modal unificado Traer guardados */
  onRecoverFromCloud?: (game: ConfiguredGame) => void;
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
  onOpenFolder,
  onRecoverFromCloud,
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
    <div className="absolute right-2 top-2 z-30" onClick={(e) => e.stopPropagation()}>
      <Dropdown placement="bottom-end" {...controlledMenu}>
        <DropdownTrigger>
          <Button
            isIconOnly
            size="sm"
            variant="flat"
            className="min-w-8 w-8 h-8 rounded-lg bg-zinc-950/65 hover:bg-zinc-900 border border-zinc-800 hover:border-primary/50 text-white/90 shadow-md backdrop-blur-md transition-all duration-300 scale-90 opacity-0 group-hover:opacity-100 group-hover:scale-100 focus:opacity-100 focus:scale-100"
            aria-label="Acciones">
            <MoreVertical size={16} />
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
          onFullBackupUpload={onFullBackupUpload}
          onRecoverFromCloud={onRecoverFromCloud}
          onShare={onShare}
          onRemove={onRemove}
        />
      </Dropdown>
    </div>
  );
}
