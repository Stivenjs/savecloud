import type { InputProps } from "@heroui/react";
import { Button, Tooltip } from "@heroui/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { DebouncedGamesSearchInput } from "@features/games/GamesFilters";
import { useShellUiStore } from "@store/ShellUiStore";
import { BigPictureHeaderHud } from "./BigPictureHeaderHud";

export interface BigPictureConsoleTopRailProps {
  profileAvatar?: string | null;
  profileFrame?: string | null;
  onOpenProfile: () => void;
  onIntentOpenProfile?: () => void;
  /** Perfil abierto: oculta la rail para que no quede encima del drawer. */
  hidden?: boolean;
}

const GLASS_BTN =
  "h-11 w-11 min-w-11 shrink-0 rounded-full border-0 bg-transparent text-white shadow-none hover:bg-white/14 focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-0";

const BP_TOP_GLASS =
  "rounded-2xl border border-white/[0.09] bg-zinc-950/38 shadow-[0_12px_44px_-14px_rgba(0,0,0,0.55)] backdrop-blur-2xl [-webkit-backdrop-filter:blur(26px)_saturate(165%)] supports-backdrop-filter:bg-zinc-800/32";

function useBpSearchRailMaxPx() {
  const [px, setPx] = useState(560);
  useLayoutEffect(() => {
    const update = () => {
      setPx(Math.min(640, Math.max(240, window.innerWidth - 140)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return px;
}

const RAIL_INPUT_CLASS_NAMES: InputProps["classNames"] = {
  base: "min-h-0 min-w-0 flex-1",
  innerWrapper: "bg-transparent px-0",
  inputWrapper:
    "!min-h-0 !h-auto !rounded-none border-none !border-0 !bg-transparent p-0 !py-2 shadow-none after:hidden before:hidden hover:!border-transparent hover:!bg-transparent data-[focus=true]:!border-transparent data-[focus=true]:!bg-transparent data-[hover=true]:!bg-transparent group-data-[focus=true]:!bg-transparent",
  input:
    "!min-h-[1.375rem] !text-[15px] !leading-snug !text-white !shadow-none outline-none md:!text-[0.975rem] placeholder:!text-zinc-400 [appearance:textfield] [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
  clearButton:
    "text-white [--heroui-colors-default-foreground:theme(colors.white)] data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-white/55 data-[focus-visible=true]:outline-offset-0",
};

/**
 * Barra superior fija modo consola (mismo anclaje y cristal en todas las rutas).
 * En `/` muestra búsqueda de biblioteca cuando GamesPage registra el setter en el store.
 */
export function BigPictureConsoleTopRail({
  profileAvatar,
  profileFrame,
  onOpenProfile,
  onIntentOpenProfile,
  hidden = false,
}: BigPictureConsoleTopRailProps) {
  const { pathname } = useLocation();
  const librarySearchTerm = useShellUiStore((s) => s.gamesBpSearchTerm);
  const librarySetSearch = useShellUiStore((s) => s.gamesBpSearchSetValue);

  const catalogSearchTerm = useShellUiStore((s) => s.catalogBpSearchTerm);
  const catalogSetSearch = useShellUiStore((s) => s.catalogBpSearchSetValue);

  const libraryMode = pathname === "/" && librarySetSearch != null;
  const catalogMode = pathname === "/catalog" && catalogSetSearch != null;
  const searchEnabled = libraryMode || catalogMode;

  const currentSearchTerm = libraryMode ? librarySearchTerm : catalogSearchTerm;
  const currentSetSearch = libraryMode ? librarySetSearch : catalogSetSearch;

  const prefersReducedMotion = useReducedMotion();
  const searchExpandMaxPx = useBpSearchRailMaxPx();
  const [searchRailOpen, setSearchRailOpen] = useState(() => currentSearchTerm.trim().length > 0);

  useEffect(() => {
    if (currentSearchTerm.trim().length > 0) setSearchRailOpen(true);
  }, [currentSearchTerm]);

  const closeRail = () => {
    setSearchRailOpen(false);
    currentSetSearch?.("");
  };

  const motionEase = prefersReducedMotion ? ([0.4, 0, 0.2, 1] as const) : ([0.16, 1, 0.3, 1] as const);
  const revealTransition = prefersReducedMotion ? { duration: 0 } : { duration: 0.28, ease: motionEase };

  if (hidden || typeof document === "undefined") return null;

  const rail = (
    <header
      className="pointer-events-none fixed inset-x-0 top-0 z-110 w-full border-none bg-transparent shadow-none"
      data-shell-bp-console-top-rail="">
      <div className="pointer-events-auto relative px-4 pb-2 pt-[max(0px,env(safe-area-inset-top))] sm:px-6 md:px-7">
        <div className="relative z-1 flex w-full justify-end" aria-label="Barra de consola">
          <div
            className={`pointer-events-auto inline-flex max-w-full min-h-12 items-center gap-4 rounded-2xl px-4 py-2 sm:min-h-13.5 sm:gap-7 md:gap-10 sm:px-5 md:px-6 ${BP_TOP_GLASS}`}>
            {searchEnabled ? (
              <>
                <AnimatePresence initial={false}>
                  {searchRailOpen ? (
                    <motion.div
                      key="bp-library-search-slot"
                      id="games-library-search-rail"
                      initial={prefersReducedMotion ? false : { maxWidth: 0, opacity: 0 }}
                      animate={{ maxWidth: searchExpandMaxPx, opacity: 1 }}
                      exit={
                        prefersReducedMotion
                          ? { maxWidth: 0, opacity: 0, transition: { duration: 0 } }
                          : { maxWidth: 0, opacity: 0, transition: { ...revealTransition, duration: 0.22 } }
                      }
                      transition={revealTransition}
                      className="min-w-0 overflow-hidden">
                      <div style={{ width: searchExpandMaxPx }} className="flex min-w-0 flex-row items-center">
                        <DebouncedGamesSearchInput
                          searchTerm={currentSearchTerm}
                          onSearchChange={(v) => currentSetSearch?.(v)}
                          compact
                          variant="flat"
                          autoFocus
                          isClearable
                          className="min-h-0 min-w-0 flex-1"
                          placeholder={libraryMode ? "Buscar en biblioteca…" : "Buscar en catálogo…"}
                          startContent={
                            <Search
                              size={18}
                              className="shrink-0 text-white/90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.72)]"
                              strokeWidth={1.65}
                              aria-hidden
                            />
                          }
                          classNames={RAIL_INPUT_CLASS_NAMES}
                        />
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>

                {!searchRailOpen ? (
                  <Tooltip
                    content={libraryMode ? "Buscar en biblioteca" : "Buscar en catálogo"}
                    placement="bottom"
                    delay={300}>
                    <Button
                      isIconOnly
                      size="md"
                      radius="full"
                      variant="light"
                      aria-expanded={false}
                      aria-label={libraryMode ? "Abrir búsqueda en biblioteca" : "Abrir búsqueda en catálogo"}
                      className={`${GLASS_BTN} shrink-0 hover:bg-white/11`}
                      onPress={() => setSearchRailOpen(true)}>
                      <Search size={21} aria-hidden strokeWidth={2} className="text-white drop-shadow-sm" />
                    </Button>
                  </Tooltip>
                ) : (
                  <Tooltip content="Cerrar búsqueda" placement="bottom" delay={260}>
                    <Button
                      isIconOnly
                      size="md"
                      radius="full"
                      variant="light"
                      aria-expanded
                      aria-controls="games-library-search-rail"
                      aria-label="Cerrar barra de búsqueda"
                      className={`${GLASS_BTN} shrink-0 hover:bg-white/11`}
                      onPress={closeRail}>
                      <X size={21} aria-hidden strokeWidth={2} className="text-white drop-shadow-sm" />
                    </Button>
                  </Tooltip>
                )}
              </>
            ) : null}

            <BigPictureHeaderHud
              overlayMode
              profileAvatar={profileAvatar}
              profileFrame={profileFrame}
              onOpenProfile={onOpenProfile}
              onIntentOpenProfile={onIntentOpenProfile}
            />
          </div>
        </div>
      </div>
    </header>
  );

  return createPortal(rail, document.body);
}
