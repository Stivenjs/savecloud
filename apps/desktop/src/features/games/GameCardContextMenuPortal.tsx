import { useCallback, useEffect } from "react";
import { Dropdown, DropdownTrigger } from "@heroui/react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { GameActionsDropdownMenu } from "@features/games/game-actions";
import { LARGE_GAME_BLOCK_SIZE_BYTES } from "@utils/packageRecommendation";

export interface GameCardContextMenuPortalProps {
  contextMenu: { game: ConfiguredGame; x: number; y: number };
  onClose: () => void;
  gameRunningStatus: Record<string, boolean>;
  statsByGameId: Map<string, GameStats>;
  syncingId?: string | null;
  downloadingId?: string | null;
  fullBackupUploadingGameId?: string | null;
  onEdit?: (g: ConfiguredGame) => void;
  onTorrent?: (g: ConfiguredGame) => void;
  onOpenFolder?: (g: ConfiguredGame) => void;
  onSync?: (g: ConfiguredGame) => void;
  onFullBackupUpload?: (g: ConfiguredGame) => void;
  onRecoverFromCloud?: (g: ConfiguredGame) => void;
  onShare?: (g: ConfiguredGame) => void;
  onRemove?: (g: ConfiguredGame) => void;
}

export function GameCardContextMenuPortal({
  contextMenu,
  onClose,
  gameRunningStatus,
  statsByGameId,
  syncingId,
  downloadingId,
  fullBackupUploadingGameId,
  onEdit,
  onTorrent,
  onOpenFolder,
  onSync,
  onFullBackupUpload,
  onRecoverFromCloud,
  onShare,
  onRemove,
}: GameCardContextMenuPortalProps) {
  const { game, x: cursorX, y: cursorY } = contextMenu;

  // Close when the page scrolls away
  useEffect(() => {
    const initialScrollY = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - initialScrollY) > 6) onClose();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [onClose]);

  const wrap = useCallback(
    (cb?: (g: ConfiguredGame) => void) =>
      cb
        ? (g: ConfiguredGame) => {
            onClose();
            cb(g);
          }
        : undefined,
    [onClose]
  );

  return (
    // Full-screen backdrop catches outside clicks.
    // Lives in document.body via portal — no ancestor CSS affects it.
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9998, pointerEvents: "auto" }}
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}>
      {/*
       * Anchor at the exact cursor position (position:fixed).
       * Because this renders in document.body, fixed positioning is
       * relative to the viewport regardless of scroll containers,
       * transforms, or contain:layout in the library grid tree.
       */}
      <div
        style={{
          position: "fixed",
          left: cursorX,
          top: cursorY,
          width: 1,
          height: 1,
          pointerEvents: "none",
        }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.stopPropagation()}>
        <Dropdown
          isOpen
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
          placement="bottom-start"
          shouldFlip
          offset={2}>
          {/* Plain visible 1px trigger — not sr-only, so getBoundingClientRect is accurate */}
          <DropdownTrigger>
            <span style={{ display: "block", width: 1, height: 1 }} />
          </DropdownTrigger>
          <GameActionsDropdownMenu
            surface="list"
            game={game}
            isGameRunning={gameRunningStatus[game.id] ?? false}
            isUploadTooLarge={(statsByGameId.get(game.id)?.localSizeBytes ?? 0) >= LARGE_GAME_BLOCK_SIZE_BYTES}
            isSyncing={syncingId === game.id || syncingId === "all"}
            isDownloading={downloadingId === game.id || downloadingId === "all"}
            isFullBackupUploading={fullBackupUploadingGameId === game.id}
            onEdit={wrap(onEdit)}
            onTorrent={wrap(onTorrent)}
            onOpenFolder={wrap(onOpenFolder)}
            onSync={wrap(onSync)}
            onFullBackupUpload={wrap(onFullBackupUpload)}
            onRecoverFromCloud={wrap(onRecoverFromCloud)}
            onShare={wrap(onShare)}
            onRemove={wrap(onRemove)}
          />
        </Dropdown>
      </div>
    </div>
  );
}
