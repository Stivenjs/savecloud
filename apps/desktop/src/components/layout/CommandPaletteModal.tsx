import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Modal, ModalContent, Kbd } from "@heroui/react";
import { Search, Gamepad2, ArrowRight, Settings, Users, History, Library, LayoutGrid, ShieldAlert } from "lucide-react";
import { useConfig } from "@hooks/useConfig";
import { formatGameDisplayName } from "@utils/gameImage";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { useGameMedia, useGameMediaBatch, getIsResolvingIds } from "@hooks/useGameMedia";
import { openOrFocusSettingsWindow } from "@/windows/settingsWindow";
import type { ConfiguredGame } from "@app-types/config";
import type { SteamAppdetailsMediaResult } from "@services/tauri";

interface NavigationCommandItem {
  type: "nav";
  id: string;
  title: string;
  subtitle?: string;
  category: "navigation" | "actions";
  icon: React.ElementType;
  action: () => void;
}

interface GameCommandItem {
  type: "game";
  id: string;
  title: string;
  game: ConfiguredGame;
  category: "games";
  action: () => void;
}

export type CommandItem = NavigationCommandItem | GameCommandItem;

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function CommandPaletteGameItem({
  game,
  resolvedSteamAppId,
  mediaBySteamAppId,
}: {
  game: ConfiguredGame;
  resolvedSteamAppId?: string;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
}) {
  const { capsuleImage, imgLoaded, imgError, handleImgLoad, handleImgError } = useGameMedia({
    game,
    resolvedSteamAppId,
    mediaBySteamAppId,
    mediaFromBatch: true,
  });

  const showFallback = !capsuleImage || imgError;

  return (
    <div className="w-14 h-8 rounded-lg overflow-hidden bg-default-100 border border-default-200/80 flex items-center justify-center shrink-0 relative shadow-xs">
      {!showFallback && (
        <img
          src={capsuleImage}
          alt=""
          className={`w-full h-full object-cover object-center transition-opacity duration-200 ${
            imgLoaded ? "opacity-100" : "opacity-0"
          }`}
          onLoad={handleImgLoad}
          onError={handleImgError}
          draggable={false}
        />
      )}
      {(showFallback || !imgLoaded) && (
        <div className="absolute inset-0 flex items-center justify-center text-default-400 bg-default-100">
          <Gamepad2 size={16} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}

export function CommandPaletteModal({ isOpen, onClose }: CommandPaletteModalProps) {
  const navigate = useNavigate();
  const { config } = useConfig();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const configuredGames: readonly ConfiguredGame[] = useMemo(() => config?.games ?? [], [config?.games]);

  const resolvedSteamAppIds = useResolvedSteamAppIds(configuredGames);
  const isResolvingIds = useMemo(
    () => getIsResolvingIds(configuredGames, resolvedSteamAppIds),
    [configuredGames, resolvedSteamAppIds]
  );
  const { mediaBySteamAppId } = useGameMediaBatch({
    games: configuredGames,
    resolvedSteamAppIds,
    isResolvingIds,
  });

  const navigationCommands: NavigationCommandItem[] = useMemo(
    () => [
      {
        type: "nav",
        id: "nav-library",
        title: "Ir a Biblioteca",
        subtitle: "Ver todos tus juegos configurados y locales",
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
        title: "Explorar Catálogo Steam",
        subtitle: "Buscar juegos oficiales y parches",
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
        title: "Amigos y Social",
        subtitle: "Ver quién está jugando y partidas activas",
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
        title: "Historial de Actividad",
        subtitle: "Registro de sincronizaciones y backups",
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
        title: "Configuración y Ajustes",
        subtitle: "Rutas, perfiles y observabilidad",
        category: "navigation",
        icon: Settings,
        action: () => {
          openOrFocusSettingsWindow();
          onClose();
        },
      },
    ],
    [navigate, onClose]
  );

  const gameCommands: GameCommandItem[] = useMemo(
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

  const actionCommands: NavigationCommandItem[] = useMemo(
    () => [
      {
        type: "nav",
        id: "action-observability",
        title: "Abrir Diagnósticos y Salud WS",
        subtitle: "Inspeccionar métricas y observabilidad remota",
        category: "actions",
        icon: ShieldAlert,
        action: () => {
          openOrFocusSettingsWindow();
          onClose();
        },
      },
    ],
    [onClose]
  );

  const allCommands = useMemo(
    () => [...gameCommands, ...navigationCommands, ...actionCommands],
    [gameCommands, navigationCommands, actionCommands]
  );

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allCommands;
    return allCommands.filter((cmd) => {
      if (cmd.type === "game") {
        return cmd.title.toLowerCase().includes(q) || cmd.game.id.toLowerCase().includes(q);
      }
      return cmd.title.toLowerCase().includes(q) || (cmd.subtitle && cmd.subtitle.toLowerCase().includes(q));
    });
  }, [allCommands, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

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
      classNames={{
        wrapper: "z-[9999] items-start pt-20",
        base: "bg-content1 border border-default-200/80 shadow-2xl rounded-2xl overflow-hidden p-0",
      }}>
      <ModalContent>
        <div onKeyDown={handleKeyDown} className="flex flex-col w-full">
          {/* Header Input */}
          <div className="flex items-center px-4 py-3.5 border-b border-default-200/80 bg-default-100/50 gap-3">
            <Search className="w-4 h-4 text-primary shrink-0" strokeWidth={2} />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar juegos o comandos... (Ctrl + K)"
              className="w-full bg-transparent text-foreground placeholder-default-400 text-sm font-medium focus:outline-none"
            />
            <Kbd
              keys={["command"]}
              className="hidden sm:inline-flex bg-default-200/80 text-default-500 text-[10px] border border-default-300/50">
              K
            </Kbd>
          </div>

          {/* Results List */}
          <div className="max-h-95 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            <AnimatePresence mode="popLayout" initial={false}>
              {filteredCommands.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="py-10 text-center text-default-400 text-xs font-medium">
                  No se encontraron resultados para &quot;{query}&quot;
                </motion.div>
              ) : (
                filteredCommands.map((cmd, idx) => {
                  const isSelected = idx === selectedIndex;
                  if (cmd.type === "game") {
                    return (
                      <motion.div
                        key={cmd.id}
                        layout
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.97 }}
                        transition={{
                          type: "spring",
                          stiffness: 480,
                          damping: 34,
                          mass: 0.8,
                          layout: { duration: 0.15, ease: "easeOut" },
                        }}
                        onClick={() => cmd.action()}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors duration-150 ${
                          isSelected
                            ? "bg-default-200/60 border border-default-300/60 text-foreground"
                            : "hover:bg-default-100/60 text-default-700 border border-transparent"
                        }`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <CommandPaletteGameItem
                            game={cmd.game}
                            resolvedSteamAppId={resolvedSteamAppIds[cmd.game.id] ?? undefined}
                            mediaBySteamAppId={mediaBySteamAppId}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-semibold truncate leading-snug">{cmd.title}</p>
                            <p className="text-[10px] text-default-400 truncate">Ver partidas y guardados</p>
                          </div>
                        </div>

                        {isSelected && (
                          <div className="flex items-center gap-1 text-[10px] font-semibold text-primary shrink-0">
                            <span>Abrir</span>
                            <ArrowRight size={12} />
                          </div>
                        )}
                      </motion.div>
                    );
                  }

                  const Icon = cmd.icon;
                  return (
                    <motion.div
                      key={cmd.id}
                      layout
                      initial={{ opacity: 0, y: 8, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -6, scale: 0.97 }}
                      transition={{
                        type: "spring",
                        stiffness: 480,
                        damping: 34,
                        mass: 0.8,
                        layout: { duration: 0.15, ease: "easeOut" },
                      }}
                      onClick={() => cmd.action()}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={`flex items-center justify-between px-3 py-2 rounded-xl cursor-pointer transition-colors duration-150 ${
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
                          <p className="text-xs font-semibold truncate leading-snug">{cmd.title}</p>
                          {cmd.subtitle && <p className="text-[10px] text-default-400 truncate">{cmd.subtitle}</p>}
                        </div>
                      </div>

                      {isSelected && (
                        <div className="flex items-center gap-1 text-[10px] font-semibold text-primary shrink-0">
                          <span>Ir</span>
                          <ArrowRight size={12} />
                        </div>
                      )}
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>

          {/* Footer Shortcuts */}
          <div className="px-4 py-2.5 border-t border-default-200/80 bg-default-100/50 flex items-center justify-between text-[11px] text-default-500">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">↑</Kbd>
                <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">↓</Kbd> Navegar
              </span>
              <span className="flex items-center gap-1">
                <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">↵</Kbd> Abrir
              </span>
            </div>
            <span className="flex items-center gap-1">
              <Kbd className="bg-default-200/80 text-default-600 text-[9px] px-1.5 py-0.5">ESC</Kbd> Cerrar
            </span>
          </div>
        </div>
      </ModalContent>
    </Modal>
  );
}
