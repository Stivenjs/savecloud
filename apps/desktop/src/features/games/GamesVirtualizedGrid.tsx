import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { cn, Dropdown, DropdownTrigger } from "@heroui/react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats, SteamAppdetailsMediaResult } from "@services/tauri";
import { GameCard } from "@features/games/GameCard";
import { needsSteamSearch } from "@utils/gameImage";
import { useNativeVirtualGrid } from "@hooks/useNativeVirtualGrid";
import { useShellUiStore } from "@store/ShellUiStore";
import type { GamesCardOrientation, GamesLayout } from "@hooks/useGamesViewPreferences";
import { GameActionsDropdownMenu } from "@features/games/game-actions";
import { LARGE_GAME_BLOCK_SIZE_BYTES } from "@utils/packageRecommendation";

export interface GamesVirtualizedGridProps {
  games: readonly ConfiguredGame[];
  layout: GamesLayout;
  cardOrientation: GamesCardOrientation;
  consoleMode?: boolean;
  statsByGameId: Map<string, GameStats>;
  resolvedSteamAppIds: Record<string, string | null | undefined>;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  gameRunningStatus: Record<string, boolean>;
  unsyncedSet: Set<string>;
  cloudBackupCountByGameId: Record<string, number>;
  onRemove?: (game: ConfiguredGame) => void;
  onSync?: (game: ConfiguredGame) => void;
  syncingId?: string | null;
  downloadingId?: string | null;
  onOpenFolder?: (game: ConfiguredGame) => void;
  onRecoverFromCloud?: (game: ConfiguredGame) => void;
  onFullBackupUpload?: (game: ConfiguredGame) => void;
  fullBackupUploadingGameId?: string | null;
  onEdit?: (game: ConfiguredGame) => void;
  onTorrent?: (game: ConfiguredGame) => void;
  onShare?: (game: ConfiguredGame) => void;
  onOpenConsoleActions?: (game: ConfiguredGame) => void;
  openActionsGameId?: string | null;
  onActionsMenuOpenChange?: (open: boolean, gameId: string) => void;
}

export function getGridClass(layout: GamesLayout, orientation: GamesCardOrientation): string {
  if (orientation === "horizontal") {
    switch (layout) {
      case "grid-lg":
        return "grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5";

      case "grid-md":
        return "grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5";

      case "list":
        return "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";
    }
  }

  switch (layout) {
    case "grid-lg":
      return "grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-5";

    case "grid-md":
      return "grid grid-cols-[repeat(auto-fill,minmax(165px,1fr))] gap-4";

    case "list":
      return "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4";
  }
}

export const GamesVirtualizedGrid = memo(function GamesVirtualizedGrid({
  games,
  layout,
  cardOrientation,
  consoleMode = false,
  statsByGameId,
  resolvedSteamAppIds,
  mediaBySteamAppId,
  gameRunningStatus,
  unsyncedSet,
  cloudBackupCountByGameId,
  onRemove,
  onSync,
  syncingId,
  downloadingId,
  onOpenFolder,
  onRecoverFromCloud,
  onFullBackupUpload,
  fullBackupUploadingGameId,
  onEdit,
  onTorrent,
  onShare,
  onOpenConsoleActions,
  openActionsGameId,
  onActionsMenuOpenChange,
}: GamesVirtualizedGridProps) {
  const isHorizontal = cardOrientation === "horizontal";
  const libraryScrollPosition = useShellUiStore((state) => state.getScrollPosition("library"));

  const gap = useMemo(() => {
    if (layout === "list") return 16;
    if (!isHorizontal && layout === "grid-md") return 16;
    return 20;
  }, [layout, isHorizontal]);

  const minItemWidth = useMemo(() => {
    if (isHorizontal) {
      if (layout === "grid-lg") return 320;
      if (layout === "grid-md") return 280;
      return 320;
    }
    if (layout === "grid-lg") return 200;
    if (layout === "grid-md") return 165;
    return 180;
  }, [layout, isHorizontal]);

  const estimatedRowHeight = useMemo(() => {
    if (isHorizontal) {
      if (layout === "grid-lg") return 170;
      if (layout === "grid-md") return 151;
      return 186;
    }
    if (layout === "grid-lg") return 320;
    if (layout === "grid-md") return 264;
    return 286;
  }, [layout, isHorizontal]);

  const computeColumns = useMemo(() => {
    if (layout !== "list") return undefined;
    if (isHorizontal) {
      return (width: number) => {
        if (width < 640) return 1;
        if (width < 1024) return 2;
        return 3;
      };
    }
    return (width: number) => {
      if (width < 640) return 2;
      if (width < 768) return 3;
      if (width < 1024) return 4;
      if (width < 1280) return 5;
      return 6;
    };
  }, [layout, isHorizontal]);

  const computeRowHeight = useCallback(
    (columnWidth: number) => {
      const cardHeight = Math.round(columnWidth * (isHorizontal ? 215 / 460 : 1.5));
      return cardHeight + gap;
    },
    [isHorizontal, gap]
  );

  const { containerRef, visibleItems, topPadding, bottomPadding, columns } = useNativeVirtualGrid({
    items: games as ConfiguredGame[],
    minItemWidth,
    gap,
    estimatedRowHeight,
    overscan: 3,
    initialScrollY: libraryScrollPosition,
    containerTopOffset: consoleMode ? 140 : 280,
    computeColumns,
    computeRowHeight,
  });

  const [contextMenu, setContextMenu] = useState<{ game: ConfiguredGame; x: number; y: number } | null>(null);

  const handleCardContextMenu = useCallback(
    (e: React.MouseEvent, game: ConfiguredGame) => {
      e.preventDefault();
      e.stopPropagation();
      const x = Math.min(e.clientX, window.innerWidth - 260);
      const y = Math.min(e.clientY, window.innerHeight - 380);
      setContextMenu({ game, x: Math.max(8, x), y: Math.max(8, y) });
      onActionsMenuOpenChange?.(true, game.id);
    },
    [onActionsMenuOpenChange]
  );

  const handleCloseContextMenu = useCallback(() => {
    if (contextMenu) {
      onActionsMenuOpenChange?.(false, contextMenu.game.id);
      setContextMenu(null);
    }
  }, [contextMenu, onActionsMenuOpenChange]);

  useEffect(() => {
    if (!contextMenu) return;
    const initialY = window.scrollY;
    const onScroll = () => {
      if (Math.abs(window.scrollY - initialY) > 6) {
        handleCloseContextMenu();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, [contextMenu, handleCloseContextMenu]);

  return (
    <div ref={containerRef} className="w-full">
      <div
        style={{
          paddingTop: `${topPadding}px`,
          paddingBottom: `${bottomPadding}px`,
          ...(layout === "list" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : {}),
        }}
        className={cn(getGridClass(layout, cardOrientation))}>
        {visibleItems.map(({ item: game, index }) => (
          <div key={game.id} className="w-full sg-card-containment">
            <GameCard
              game={game}
              orientation={cardOrientation}
              priority={index < 8}
              stats={statsByGameId.get(game.id)}
              resolvedSteamAppId={resolvedSteamAppIds[game.id]}
              mediaBySteamAppId={mediaBySteamAppId}
              mediaFromBatch
              isGameRunning={gameRunningStatus[game.id] ?? false}
              isUnsynced={unsyncedSet.has(game.id)}
              cloudBackupCount={cloudBackupCountByGameId[game.id] ?? 0}
              isLoading={needsSteamSearch(game) && resolvedSteamAppIds[game.id] === undefined}
              onRemove={onRemove}
              onSync={onSync}
              isSyncing={syncingId === game.id || syncingId === "all"}
              isDownloading={downloadingId === game.id || downloadingId === "all"}
              onOpenFolder={onOpenFolder}
              onRecoverFromCloud={onRecoverFromCloud}
              onFullBackupUpload={onFullBackupUpload}
              isFullBackupUploading={fullBackupUploadingGameId === game.id}
              onEdit={onEdit}
              onTorrent={onTorrent}
              onShare={onShare}
              onOpenConsoleActions={onOpenConsoleActions}
              actionsMenuOpen={contextMenu?.game.id === game.id || openActionsGameId === game.id}
              onActionsMenuOpenChange={onActionsMenuOpenChange}
              onContextMenu={handleCardContextMenu}
            />
          </div>
        ))}
      </div>

      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            width: 1,
            height: 1,
            pointerEvents: "none",
            zIndex: 9999,
          }}>
          <Dropdown
            isOpen={true}
            onOpenChange={(open) => {
              if (!open) handleCloseContextMenu();
            }}
            placement="bottom-start"
            offset={4}>
            <DropdownTrigger>
              <span className="sr-only" aria-hidden="true" />
            </DropdownTrigger>
            <GameActionsDropdownMenu
              surface="list"
              game={contextMenu.game}
              isGameRunning={gameRunningStatus[contextMenu.game.id] ?? false}
              isUploadTooLarge={
                (statsByGameId.get(contextMenu.game.id)?.localSizeBytes ?? 0) >= LARGE_GAME_BLOCK_SIZE_BYTES
              }
              isSyncing={syncingId === contextMenu.game.id || syncingId === "all"}
              isDownloading={downloadingId === contextMenu.game.id || downloadingId === "all"}
              isFullBackupUploading={fullBackupUploadingGameId === contextMenu.game.id}
              onEdit={(g) => {
                handleCloseContextMenu();
                onEdit?.(g);
              }}
              onTorrent={(g) => {
                handleCloseContextMenu();
                onTorrent?.(g);
              }}
              onOpenFolder={(g) => {
                handleCloseContextMenu();
                onOpenFolder?.(g);
              }}
              onSync={(g) => {
                handleCloseContextMenu();
                onSync?.(g);
              }}
              onFullBackupUpload={(g) => {
                handleCloseContextMenu();
                onFullBackupUpload?.(g);
              }}
              onRecoverFromCloud={(g) => {
                handleCloseContextMenu();
                onRecoverFromCloud?.(g);
              }}
              onShare={(g) => {
                handleCloseContextMenu();
                onShare?.(g);
              }}
              onRemove={(g) => {
                handleCloseContextMenu();
                onRemove?.(g);
              }}
            />
          </Dropdown>
        </div>
      )}
    </div>
  );
});
