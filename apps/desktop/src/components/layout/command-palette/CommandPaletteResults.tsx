import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Gamepad2, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { useGameMedia, useGameMediaBatch, getIsResolvingIds } from "@hooks/useGameMedia";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import type { ConfiguredGame } from "@app-types/config";
import type { CatalogGameCommandItem, CommandItem, LocalGameCommandItem } from "./commandPaletteTypes";

const ROW_HEIGHT = 52;
const OVERSCAN = 5;

function isGameCommand(command: CommandItem): command is LocalGameCommandItem | CatalogGameCommandItem {
  return command.type === "game" || command.type === "catalog";
}

function isLocalGameCommand(command: CommandItem): command is LocalGameCommandItem {
  return command.type === "game";
}

function isCatalogGameCommand(command: CommandItem): command is CatalogGameCommandItem {
  return command.type === "catalog";
}

interface CommandPaletteResultsProps {
  commands: CommandItem[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  query: string;
  resetKey: string;
}

function GameThumbnail({
  game,
  resolvedSteamAppId,
  mediaBySteamAppId,
}: {
  game: ConfiguredGame;
  resolvedSteamAppId?: string;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
}) {
  const { displayImageUrl, isEffectivelyLoading, imgLoaded, imgError, handleImgLoad, handleImgError } = useGameMedia({
    game,
    resolvedSteamAppId: resolvedSteamAppId ?? null,
    mediaBySteamAppId,
    mediaFromBatch: true,
  });

  return (
    <div className="relative w-14 h-8 rounded-lg overflow-hidden shrink-0 bg-default-100 border border-default-200/80">
      {isEffectivelyLoading && !imgLoaded && <div className="absolute inset-0 bg-default-200 animate-pulse" />}
      {displayImageUrl && !imgError ? (
        <img
          src={displayImageUrl}
          alt={game.id}
          className={`w-full h-full object-cover transition-opacity duration-200 ${imgLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={handleImgLoad}
          onError={handleImgError}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-default-400">
          <Gamepad2 size={16} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}

function CommandPaletteResultRow({
  command,
  index,
  selected,
  onSelectIndex,
  resolvedSteamAppIds,
  mediaBySteamAppId,
}: {
  command: CommandItem;
  index: number;
  selected: boolean;
  onSelectIndex: (index: number) => void;
  resolvedSteamAppIds: Record<string, string | null | undefined>;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
}) {
  const { t } = useTranslation();
  const gameCommand = isGameCommand(command) ? command : null;
  const isCatalog = command.type === "catalog";
  const Icon = command.type === "nav" ? command.icon : null;
  const actionLabel = gameCommand
    ? isCatalog
      ? t("commandPalette.exploreAction", "Explorar")
      : t("commandPalette.openAction", "Abrir")
    : t("commandPalette.goAction", "Ir");

  return (
    <div
      onClick={command.action}
      onMouseEnter={() => onSelectIndex(index)}
      className={`h-13 flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-[background-color,border-color] duration-100 ease-out ${
        selected
          ? "bg-default-200/60 border border-default-300/60 text-foreground"
          : "hover:bg-default-100/60 text-default-700 border border-transparent"
      }`}>
      <div className="flex items-center gap-3 min-w-0">
        {gameCommand ? (
          <GameThumbnail
            game={gameCommand.game}
            resolvedSteamAppId={
              gameCommand.type === "catalog"
                ? gameCommand.steamAppId
                : (resolvedSteamAppIds[gameCommand.game.id] ?? undefined)
            }
            mediaBySteamAppId={mediaBySteamAppId}
          />
        ) : (
          <div
            className={`w-14 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
              selected
                ? "bg-primary/15 border-primary/30 text-primary"
                : "bg-default-100 border-default-200/80 text-default-400"
            }`}>
            {Icon && <Icon size={16} strokeWidth={1.5} />}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold truncate leading-snug text-foreground">{command.title}</p>
            {gameCommand && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-md font-medium shrink-0 ${
                  isCatalog ? "bg-secondary/15 text-secondary" : "bg-primary/10 text-primary"
                }`}>
                {gameCommand.type === "catalog"
                  ? t("commandPalette.steamCatalog", "Catálogo Steam")
                  : t("commandPalette.yourLibrary", "Tu Biblioteca")}
              </span>
            )}
          </div>
          <p className="text-[10px] text-default-400 truncate">
            {gameCommand
              ? gameCommand.type === "catalog"
                ? t("commandPalette.catalogDesc", "Ver ficha, media y descargas")
                : t("commandPalette.localSavesDesc", "Ver partidas y guardados locales")
              : command.type === "nav"
                ? command.subtitle
                : undefined}
          </p>
        </div>
      </div>
      {selected && (
        <div
          className={`flex items-center gap-1 text-[10px] font-semibold ${isCatalog ? "text-secondary" : "text-primary"} shrink-0`}>
          <span>{actionLabel}</span>
          <ArrowRight size={12} />
        </div>
      )}
    </div>
  );
}

export function CommandPaletteResults({
  commands,
  selectedIndex,
  onSelectIndex,
  query,
  resetKey,
}: CommandPaletteResultsProps) {
  const { t } = useTranslation();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const firstIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(384 / ROW_HEIGHT) + OVERSCAN * 2;
  const visibleCommands = useMemo(
    () => commands.slice(firstIndex, firstIndex + visibleCount),
    [commands, firstIndex, visibleCount]
  );
  const localGames = useMemo(
    () => visibleCommands.filter(isLocalGameCommand).map((item) => item.game),
    [visibleCommands]
  );
  const catalogGames = useMemo(
    () => visibleCommands.filter(isCatalogGameCommand).map((item) => item.game),
    [visibleCommands]
  );
  const mediaGames = useMemo(() => [...localGames, ...catalogGames], [localGames, catalogGames]);
  const resolvedSteamAppIds = useResolvedSteamAppIds(localGames);
  const isResolvingIds = getIsResolvingIds(localGames, resolvedSteamAppIds);
  const { mediaBySteamAppId } = useGameMediaBatch({
    games: mediaGames,
    resolvedSteamAppIds,
    isResolvingIds,
  });

  useEffect(() => {
    setScrollTop(0);
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [resetKey]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const top = selectedIndex * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [selectedIndex]);

  if (commands.length === 0) {
    return (
      <div className="min-h-75 max-h-96 overflow-y-auto p-2 custom-scrollbar">
        <div className="flex flex-col items-center justify-center min-h-70 text-center text-default-400 text-xs font-medium gap-1 animate-in fade-in duration-150">
          <Search size={24} className="text-default-300 mb-1" strokeWidth={1.5} />
          <span>
            {t("commandPalette.noResults", { query, defaultValue: `No se encontraron resultados para "${query}"` })}
          </span>
          <span className="text-[11px] text-default-400/80">
            {t("commandPalette.noResultsHint", "Prueba buscando otro título o comando")}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      className="min-h-75 max-h-96 overflow-y-auto p-2 custom-scrollbar">
      <div aria-hidden="true" style={{ height: firstIndex * ROW_HEIGHT }} />
      {visibleCommands.map((command, offset) => {
        const index = firstIndex + offset;
        return (
          <CommandPaletteResultRow
            key={command.id}
            command={command}
            index={index}
            selected={index === selectedIndex}
            onSelectIndex={onSelectIndex}
            resolvedSteamAppIds={resolvedSteamAppIds}
            mediaBySteamAppId={mediaBySteamAppId}
          />
        );
      })}
      <div
        aria-hidden="true"
        style={{ height: Math.max(0, commands.length - firstIndex - visibleCommands.length) * ROW_HEIGHT }}
      />
    </div>
  );
}
