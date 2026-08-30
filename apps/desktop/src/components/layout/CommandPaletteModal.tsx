import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, ModalContent, Kbd, Spinner } from "@heroui/react";
import { Search, Gamepad2, ArrowRight, Settings, Users, History, Library, LayoutGrid, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useConfig } from "@hooks/useConfig";
import { formatGameDisplayName } from "@utils/gameImage";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { useGameMedia, useGameMediaBatch, getIsResolvingIds } from "@hooks/useGameMedia";
import { openOrFocusSettingsWindow } from "@/windows/settingsWindow";
import { searchSteamCatalog, type CatalogListItem, type SteamAppdetailsMediaResult } from "@services/tauri";
import { STEAM_CATALOG_GAME_ID_PREFIX } from "@utils/steamCatalogGameId";
import { catalogListItemToConfiguredGame } from "@features/steam-catalog/model/catalogConfiguredGame";
import { useShellUiStore } from "@store/ShellUiStore";
import { STEAM_CATALOG_URL_Q } from "@/constants/constants";
import type { ConfiguredGame } from "@app-types/config";

interface NavigationCommandItem {
  type: "nav";
  id: string;
  title: string;
  subtitle?: string;
  category: "navigation" | "actions";
  icon: React.ElementType;
  action: () => void;
}

interface LocalGameCommandItem {
  type: "game";
  id: string;
  title: string;
  game: ConfiguredGame;
  category: "games";
  action: () => void;
}

interface CatalogGameCommandItem {
  type: "catalog";
  id: string;
  title: string;
  game: ConfiguredGame;
  steamAppId: string;
  category: "catalog";
  action: () => void;
}

export type CommandItem = NavigationCommandItem | LocalGameCommandItem | CatalogGameCommandItem;

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function CommandPaletteGameThumbnail({
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
          className={`w-full h-full object-cover transition-opacity duration-200 ${
            imgLoaded ? "opacity-100" : "opacity-0"
          }`}
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

export function CommandPaletteModal({ isOpen, onClose }: CommandPaletteModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { config } = useConfig();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [catalogResults, setCatalogResults] = useState<CatalogListItem[]>([]);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setCatalogResults([]);
    } else {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const configuredGames: ConfiguredGame[] = useMemo(() => config?.games ?? [], [config?.games]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setCatalogResults([]);
      setIsCatalogLoading(false);
      return;
    }

    let active = true;
    setIsCatalogLoading(true);

    const timer = setTimeout(async () => {
      try {
        const results = await searchSteamCatalog(trimmed, 4);
        if (active) {
          setCatalogResults(results || []);
        }
      } catch {
        if (active) setCatalogResults([]);
      } finally {
        if (active) setIsCatalogLoading(false);
      }
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const catalogGames: ConfiguredGame[] = useMemo(
    () => catalogResults.map(catalogListItemToConfiguredGame),
    [catalogResults]
  );

  const combinedGames = useMemo(() => [...configuredGames, ...catalogGames], [configuredGames, catalogGames]);

  const resolvedSteamAppIds = useResolvedSteamAppIds(configuredGames);
  const isResolvingIds = useMemo(
    () => getIsResolvingIds(configuredGames, resolvedSteamAppIds),
    [configuredGames, resolvedSteamAppIds]
  );

  const { mediaBySteamAppId } = useGameMediaBatch({
    games: combinedGames,
    resolvedSteamAppIds,
    isResolvingIds,
  });

  const navigationCommands: NavigationCommandItem[] = useMemo(
    () => [
      {
        type: "nav",
        id: "nav-library",
        title: t("commandPalette.navLibraryTitle", "Ir a Biblioteca"),
        subtitle: t("commandPalette.navLibrarySubtitle", "Ver todos tus juegos configurados y locales"),
        category: "navigation",
        icon: Library,
        action: () => {
          navigate("/");
          onClose();
        },
      },
      {
        type: "nav",
        id: "nav-catalog",
        title: t("commandPalette.navCatalogTitle", "Explorar Catálogo Steam"),
        subtitle: t("commandPalette.navCatalogSubtitle", "Buscar juegos oficiales, demos y parches"),
        category: "navigation",
        icon: LayoutGrid,
        action: () => {
          navigate("/catalog");
          onClose();
        },
      },
      {
        type: "nav",
        id: "nav-social",
        title: t("commandPalette.navSocialTitle", "Amigos y Social"),
        subtitle: t("commandPalette.navSocialSubtitle", "Ver quién está jugando y partidas activas"),
        category: "navigation",
        icon: Users,
        action: () => {
          navigate("/friends");
          onClose();
        },
      },
      {
        type: "nav",
        id: "nav-history",
        title: t("commandPalette.navHistoryTitle", "Historial de Actividad"),
        subtitle: t("commandPalette.navHistorySubtitle", "Registro de sincronizaciones y backups"),
        category: "navigation",
        icon: History,
        action: () => {
          navigate("/history");
          onClose();
        },
      },
      {
        type: "nav",
        id: "nav-settings",
        title: t("commandPalette.navSettingsTitle", "Configuración y Ajustes"),
        subtitle: t("commandPalette.navSettingsSubtitle", "Rutas, perfiles y observabilidad"),
        category: "navigation",
        icon: Settings,
        action: () => {
          void openOrFocusSettingsWindow();
          onClose();
        },
      },
      {
        type: "nav",
        id: "action-observability",
        title: t("commandPalette.navObservabilityTitle", "Diagnósticos y Salud WS"),
        subtitle: t("commandPalette.navObservabilitySubtitle", "Inspeccionar métricas y observabilidad remota"),
        category: "actions",
        icon: ShieldAlert,
        action: () => {
          void openOrFocusSettingsWindow();
          onClose();
        },
      },
    ],
    [navigate, onClose, t]
  );

  const localGameCommands: LocalGameCommandItem[] = useMemo(
    () =>
      configuredGames.map((game) => ({
        type: "game",
        id: `game-${game.id}`,
        title: formatGameDisplayName(game.id),
        game,
        category: "games" as const,
        action: () => {
          navigate(`/games/${game.id}`);
          onClose();
        },
      })),
    [configuredGames, navigate, onClose]
  );

  const catalogGameCommands: CatalogGameCommandItem[] = useMemo(
    () =>
      catalogResults.map((item) => {
        const game = catalogListItemToConfiguredGame(item);
        return {
          type: "catalog",
          id: `catalog-${item.steamAppId}`,
          title: item.name,
          game,
          steamAppId: item.steamAppId,
          category: "catalog" as const,
          action: () => {
            navigate(`/games/${STEAM_CATALOG_GAME_ID_PREFIX}${item.steamAppId}`);
            onClose();
          },
        };
      }),
    [catalogResults, navigate, onClose]
  );

  const filteredCommands: CommandItem[] = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) {
      return [...localGameCommands, ...navigationCommands];
    }

    const filteredLocal = localGameCommands.filter(
      (cmd) => cmd.title.toLowerCase().includes(q) || cmd.game.id.toLowerCase().includes(q)
    );

    const filteredNav = navigationCommands.filter(
      (cmd) => cmd.title.toLowerCase().includes(q) || (cmd.subtitle && cmd.subtitle.toLowerCase().includes(q))
    );

    const list: CommandItem[] = [...filteredLocal, ...catalogGameCommands, ...filteredNav];

    // Acción para explorar directamente en la vista del catálogo
    if (q.length > 0) {
      const trimmed = deferredQuery.trim();
      list.push({
        type: "nav",
        id: "action-search-in-catalog",
        title: t("commandPalette.searchInCatalog", {
          query: trimmed,
          defaultValue: `Buscar "${trimmed}" en el Catálogo Steam`,
        }),
        subtitle: t("commandPalette.searchInCatalogSubtitle", "Abrir catálogo completo con este filtro"),
        category: "actions",
        icon: Search,
        action: () => {
          useShellUiStore.getState().setCatalogBpSearchTerm(trimmed);
          navigate(`/catalog?${STEAM_CATALOG_URL_Q}=${encodeURIComponent(trimmed)}`);
          onClose();
        },
      });
    }

    return list;
  }, [deferredQuery, localGameCommands, catalogGameCommands, navigationCommands, navigate, onClose, t]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [deferredQuery, catalogResults]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (filteredCommands.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = filteredCommands[selectedIndex];
        if (selected) {
          selected.action();
        }
      }
    },
    [filteredCommands, selectedIndex]
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      hideCloseButton
      size="2xl"
      backdrop="blur"
      motionProps={{
        variants: {
          enter: {
            y: 0,
            opacity: 1,
            scale: 1,
            transition: {
              duration: 0.18,
              ease: [0.16, 1, 0.3, 1],
            },
          },
          exit: {
            y: -10,
            opacity: 0,
            scale: 0.98,
            transition: {
              duration: 0.12,
              ease: "easeIn",
            },
          },
        },
      }}
      classNames={{
        wrapper: "z-[9999] items-start pt-20",
        base: "bg-content1 border border-default-200/80 shadow-2xl rounded-2xl overflow-hidden p-0 transform-gpu",
      }}>
      <ModalContent>
        <div onKeyDown={handleKeyDown} className="flex flex-col w-full">
          {/* Header Input */}
          <div className="flex items-center px-4 py-3.5 border-b border-default-200/80 bg-default-100/50 gap-3">
            {isCatalogLoading ? (
              <Spinner size="sm" color="primary" className="shrink-0" />
            ) : (
              <Search className="w-4 h-4 text-primary shrink-0" strokeWidth={2} />
            )}
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("commandPalette.placeholder", "Buscar en biblioteca y catálogo Steam... (Ctrl + K)")}
              className="w-full bg-transparent text-foreground placeholder-default-400 text-sm font-medium focus:outline-none"
            />
            <Kbd
              keys={["command"]}
              className="hidden sm:inline-flex bg-default-200/80 text-default-500 text-[10px] border border-default-300/50">
              K
            </Kbd>
          </div>

          {/* Results List con altura mínima estable para evitar saltos al teclear */}
          <div className="min-h-75 max-h-96 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {filteredCommands.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-70 text-center text-default-400 text-xs font-medium gap-1 animate-in fade-in duration-150">
                <Search size={24} className="text-default-300 mb-1" strokeWidth={1.5} />
                <span>
                  {t("commandPalette.noResults", {
                    query,
                    defaultValue: `No se encontraron resultados para "${query}"`,
                  })}
                </span>
                <span className="text-[11px] text-default-400/80">
                  {t("commandPalette.noResultsHint", "Prueba buscando otro título o comando")}
                </span>
              </div>
            ) : (
              filteredCommands.map((cmd, idx) => {
                const isSelected = idx === selectedIndex;

                if (cmd.type === "game") {
                  return (
                    <div
                      key={cmd.id}
                      onClick={() => cmd.action()}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-[background-color,border-color] duration-100 ease-out ${
                        isSelected
                          ? "bg-default-200/60 border border-default-300/60 text-foreground"
                          : "hover:bg-default-100/60 text-default-700 border border-transparent"
                      }`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <CommandPaletteGameThumbnail
                          game={cmd.game}
                          resolvedSteamAppId={resolvedSteamAppIds[cmd.game.id] ?? undefined}
                          mediaBySteamAppId={mediaBySteamAppId}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold truncate leading-snug text-foreground">{cmd.title}</p>
                            <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-primary/10 text-primary font-medium shrink-0">
                              {t("commandPalette.yourLibrary", "Tu Biblioteca")}
                            </span>
                          </div>
                          <p className="text-[10px] text-default-400 truncate">
                            {t("commandPalette.localSavesDesc", "Ver partidas y guardados locales")}
                          </p>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-primary shrink-0">
                          <span>{t("commandPalette.openAction", "Abrir")}</span>
                          <ArrowRight size={12} />
                        </div>
                      )}
                    </div>
                  );
                }

                if (cmd.type === "catalog") {
                  return (
                    <div
                      key={cmd.id}
                      onClick={() => cmd.action()}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-[background-color,border-color] duration-100 ease-out ${
                        isSelected
                          ? "bg-default-200/60 border border-default-300/60 text-foreground"
                          : "hover:bg-default-100/60 text-default-700 border border-transparent"
                      }`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <CommandPaletteGameThumbnail
                          game={cmd.game}
                          resolvedSteamAppId={cmd.steamAppId}
                          mediaBySteamAppId={mediaBySteamAppId}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-xs font-semibold truncate leading-snug text-foreground">{cmd.title}</p>
                            <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-secondary/15 text-secondary font-medium shrink-0">
                              {t("commandPalette.steamCatalog", "Catálogo Steam")}
                            </span>
                          </div>
                          <p className="text-[10px] text-default-400 truncate">
                            {t("commandPalette.catalogDesc", "Ver ficha, media y descargas")}
                          </p>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-secondary shrink-0">
                          <span>{t("commandPalette.exploreAction", "Explorar")}</span>
                          <ArrowRight size={12} />
                        </div>
                      )}
                    </div>
                  );
                }

                const Icon = cmd.icon;
                return (
                  <div
                    key={cmd.id}
                    onClick={() => cmd.action()}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-[background-color,border-color] duration-100 ease-out ${
                      isSelected
                        ? "bg-default-200/60 border border-default-300/60 text-foreground"
                        : "hover:bg-default-100/60 text-default-700 border border-transparent"
                    }`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-14 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
                          isSelected
                            ? "bg-primary/15 border-primary/30 text-primary"
                            : "bg-default-100 border-default-200/80 text-default-400"
                        }`}>
                        <Icon size={16} strokeWidth={1.5} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate leading-snug text-foreground">{cmd.title}</p>
                        {cmd.subtitle && <p className="text-[10px] text-default-400 truncate">{cmd.subtitle}</p>}
                      </div>
                    </div>

                    {isSelected && (
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-primary shrink-0">
                        <span>{t("commandPalette.goAction", "Ir")}</span>
                        <ArrowRight size={12} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer Shortcuts */}
          <div className="px-4 py-2.5 border-t border-default-200/80 bg-default-100/50 flex items-center justify-between text-[11px] text-default-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">↑</Kbd>
                <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">↓</Kbd>{" "}
                {t("commandPalette.navigateShortcut", "Navegar")}
              </span>
              <span className="flex items-center gap-1">
                <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">↵</Kbd>{" "}
                {t("commandPalette.openShortcut", "Abrir")}
              </span>
            </div>
            <span className="flex items-center gap-1">
              <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">ESC</Kbd>{" "}
              {t("commandPalette.closeShortcut", "Cerrar")}
            </span>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
