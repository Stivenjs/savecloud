import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@heroui/react";
import type { CatalogListItem, SteamAppdetailsMediaResult, SourceBestMatch } from "@services/tauri";
import type { ConfiguredGame } from "@app-types/config";
import { CatalogGridItem } from "@features/steam-catalog/components/SteamCatalogGridItem";

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(4);

  useEffect(() => {
    if (!containerRef.current) return;
    const minWidth = consoleMode ? 320 : 280;
    const gap = 20;

    const updateColumns = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const cols = Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
      setColumnCount(cols);
    };

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [consoleMode]);

  const rowCount = Math.ceil(items.length / columnCount);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => (consoleMode ? 320 : 266),
    getItemKey: (index) => index,
    overscan: 6,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });

  useLayoutEffect(() => {
    virtualizer.measure();
  }, [columnCount, consoleMode]);

  return (
    <div ref={containerRef} className="relative w-full">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const rowStartIndex = virtualRow.index * columnCount;
          const rowItems = items.slice(rowStartIndex, rowStartIndex + columnCount);

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full pb-5"
              style={{
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
              }}>
              <div
                className={cn(
                  "grid gap-5",
                  consoleMode
                    ? "grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
                    : "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]"
                )}>
                {rowItems.map((item, colIdx) => {
                  const idx = rowStartIndex + colIdx;
                  const libraryGame =
                    (item.steamAppId ? libraryGamesMap.get(String(item.steamAppId)) : undefined) ??
                    libraryGamesMap.get(item.name.toLowerCase());

                  const uniqueKey = item.steamAppId ? `steam-${item.steamAppId}` : `${item.name}-${idx}`;

                  return (
                    <CatalogGridItem
                      key={uniqueKey}
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
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
