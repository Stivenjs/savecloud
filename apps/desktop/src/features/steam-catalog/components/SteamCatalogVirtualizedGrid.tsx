import { memo } from "react";
import { cn } from "@heroui/react";
import type { CatalogListItem, SteamAppdetailsMediaResult, SourceBestMatch } from "@services/tauri";
import type { ConfiguredGame } from "@app-types/config";
import { CatalogGridItem } from "@features/steam-catalog/components/SteamCatalogGridItem";
import { useNativeVirtualGrid } from "@hooks/useNativeVirtualGrid";

import { useShellUiStore } from "@store/ShellUiStore";

export type SteamCatalogVirtualizedGridProps = {
  items: CatalogListItem[];
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  matchByGameName: Record<string, SourceBestMatch[]>;
  pickByGame: Record<string, string>;
  isMatchingPending: boolean;
  libraryGamesMap: Map<string, ConfiguredGame>;
  onPickChange: (gameName: string, key: string) => void;
  onInstall: (gameName: string) => void;
  consoleMode?: boolean;
};

export const SteamCatalogVirtualizedGrid = memo(function SteamCatalogVirtualizedGrid({
  items,
  mediaBySteamAppId,
  matchByGameName,
  pickByGame,
  isMatchingPending,
  libraryGamesMap,
  onPickChange,
  onInstall,
  consoleMode = false,
}: SteamCatalogVirtualizedGridProps) {
  const minItemWidth = consoleMode ? 320 : 280;
  const estimatedRowHeight = consoleMode ? 330 : 235;
  const catalogScrollPosition = useShellUiStore((state) => state.catalogScrollPosition);

  const { containerRef, visibleItems, topPadding, bottomPadding } = useNativeVirtualGrid({
    items,
    minItemWidth,
    gap: 20,
    estimatedRowHeight,
    overscan: 4,
    initialScrollY: catalogScrollPosition,
  });

  return (
    <div ref={containerRef} className="w-full">
      <div
        style={{
          paddingTop: `${topPadding}px`,
          paddingBottom: `${bottomPadding}px`,
        }}
        className={cn(
          "grid gap-5",
          consoleMode
            ? "grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]"
        )}>
        {visibleItems.map(({ item, index }) => {
          const libraryGame =
            (item.steamAppId ? libraryGamesMap.get(String(item.steamAppId)) : undefined) ??
            libraryGamesMap.get(item.name.toLowerCase());

          const uniqueKey = item.steamAppId ? `steam-${item.steamAppId}` : `${item.name}-${index}`;

          return (
            <div key={uniqueKey} className="w-full">
              <CatalogGridItem
                item={item}
                libraryGame={libraryGame}
                mediaBySteamAppId={mediaBySteamAppId}
                match={matchByGameName[item.name]}
                selectKey={pickByGame[item.name]}
                isMatchingPending={isMatchingPending && !(item.name in matchByGameName)}
                onPickChange={onPickChange}
                onInstall={onInstall}
                consoleMode={consoleMode}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
