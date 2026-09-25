import { memo, useState } from "react";
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

import { useGamesCardOrientation } from "@hooks/useGamesViewPreferences";

export const SteamCatalogVirtualizedGrid = memo(function SteamCatalogVirtualizedGrid({
  items,
  mediaBySteamAppId,
  matchByGameName,
  pickByGame,
  libraryGamesMap,
  onPickChange,
  onInstall,
  consoleMode = false,
}: SteamCatalogVirtualizedGridProps) {
  const cardOrientation = useGamesCardOrientation();
  const isHorizontal = cardOrientation === "horizontal";
  const minItemWidth = consoleMode ? (isHorizontal ? 320 : 220) : isHorizontal ? 280 : 180;
  const estimatedRowHeight = consoleMode ? (isHorizontal ? 330 : 410) : isHorizontal ? 235 : 330;
  const [initialCatalogScrollY] = useState(() => useShellUiStore.getState().getScrollPosition("catalog"));

  const { containerRef, visibleItems, topPadding, bottomPadding, totalHeight } = useNativeVirtualGrid({
    items,
    minItemWidth,
    gap: 20,
    estimatedRowHeight,
    overscan: 4,
    initialScrollY: initialCatalogScrollY,
    computeRowHeight: (columnWidth) => {
      const imageHeight = Math.round(columnWidth * (isHorizontal ? 215 / 460 : 1.5));
      const bottomActionHeight = minItemWidth >= 320 ? 104 : 72;
      const cardGap = 8;
      return imageHeight + cardGap + bottomActionHeight + 20;
    },
  });

  return (
    <div ref={containerRef} className="w-full" style={{ minHeight: totalHeight > 0 ? `${totalHeight}px` : undefined }}>
      <div
        style={{
          paddingTop: `${topPadding}px`,
          paddingBottom: `${bottomPadding}px`,
        }}
        className={cn(
          "grid gap-5",
          consoleMode
            ? isHorizontal
              ? "grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
              : "grid-cols-[repeat(auto-fill,minmax(220px,1fr))]"
            : isHorizontal
              ? "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]"
              : "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]"
        )}>
        {visibleItems.map(({ item, index }) => {
          const libraryGame =
            (item.steamAppId ? libraryGamesMap.get(String(item.steamAppId)) : undefined) ??
            libraryGamesMap.get(item.name.toLowerCase());

          const uniqueKey = item.steamAppId ? `steam-${item.steamAppId}` : `${item.name}-${index}`;

          return (
            <div key={uniqueKey} className="w-full sg-card-containment">
              <CatalogGridItem
                item={item}
                libraryGame={libraryGame}
                mediaBySteamAppId={mediaBySteamAppId}
                match={matchByGameName[item.name]}
                selectKey={pickByGame[item.name]}
                isMatchingPending={!matchByGameName || !(item.name in matchByGameName)}
                onPickChange={onPickChange}
                onInstall={onInstall}
                consoleMode={consoleMode}
                orientation={cardOrientation}
                priority={index < 8}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});
