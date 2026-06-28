import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CatalogListItem } from "@services/tauri";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import type { SourceBestMatch } from "@services/tauri";
import { GameCard } from "@features/games/GameCard";
import { GamesListMotionContainer, GamesListMotionItem } from "@features/games/GamesListMotion";
import { catalogListItemToConfiguredGame } from "@features/steam-catalog/model/catalogConfiguredGame";
import { Button, Select, SelectItem, cn } from "@heroui/react";
import { startPeerGameDownload, startSourceDownload } from "@services/tauri";
import type { PeerInstallOffer } from "@services/tauri/inventory.service";
import { usePeerInstallOffers } from "@hooks/usePeerInstallOffers";
import { pickCandidate, sourceCandidateKey } from "@utils/sourceMatch";
import { toastError, toastSuccess } from "@utils/toast";
import { useLocation, useNavigate } from "react-router-dom";
import { addTransitionType, startTransition } from "react";
import { useConfig } from "@hooks/useConfig";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";
import type { ConfiguredGame } from "@app-types/config";
import { useDisclosure } from "@heroui/react";
import { InstallModal } from "@features/steam-catalog/components/InstallModal";

type PickByGame = Record<string, string>;

type CatalogGridItemProps = {
  item: CatalogListItem;
  libraryGame?: ConfiguredGame;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  match: SourceBestMatch[] | undefined;
  selectKey: string | undefined;
  isMatchingPending: boolean;
  onPickChange: (gameName: string, key: string) => void;
  onInstall: (gameName: string) => void;
  consoleMode?: boolean;
};

const CONSOLE_SOURCE_LISTBOX_PROPS = {
  itemClasses: {
    base: "min-h-14 rounded-lg px-4 py-2 data-[hover=true]:bg-default-200/55 dark:data-[hover=true]:bg-default-100/25",
    title: "text-base font-semibold leading-snug text-foreground sm:text-lg",
    wrapper: "py-1",
    selectedIcon: "text-primary [&_svg]:size-5",
  },
  classNames: {
    list: "gap-1 px-1 py-2",
    base: "p-0",
  },
};

/**
 * Extraído y memoizado para que cambios en filtros/búsqueda/paginación del padre
 * no re-renderizen las cards que no cambiaron. Solo se re-renderiza si alguna de
 * sus props cambia, lo que ocurre únicamente cuando:
 * - el ítem propio cambió (nueva página, nuevo orden)
 * - su match o selectKey cambió
 * - isMatchingPending cambió
 */
const CatalogGridItem = memo(function CatalogGridItem({
  item,
  libraryGame,
  mediaBySteamAppId,
  match,
  selectKey,
  isMatchingPending,
  onPickChange,
  onInstall,
  consoleMode = false,
}: CatalogGridItemProps) {
  const isLowPerf = useLowPerformanceMode();
  const game = libraryGame ?? catalogListItemToConfiguredGame(item);
  const navigate = useNavigate();
  const location = useLocation();
  const candidates = match ?? [];
  const best = candidates.length > 0 ? candidates[0] : undefined;

  return (
    <GamesListMotionItem key={game.id}>
      <div className="space-y-2">
        <div
          className="overflow-hidden rounded-xl ring-1 ring-transparent 
                    transition-all duration-200 
                    group-hover/card:ring-primary/30 
                    group-hover/card:shadow-lg group-hover/card:shadow-primary/10
                    group-hover/card:-translate-y-0.5">
          <GameCard
            variant="catalog"
            game={game}
            cardTitle={item.name}
            mediaBySteamAppId={mediaBySteamAppId ?? null}
            mediaFromBatch
            onCardNavigate={() => {
              const from = `${location.pathname}${location.search}`;
              if (libraryGame) {
                navigate(`/games/${libraryGame.id}`, {
                  state: { catalogDisplayName: item.name, from },
                });
                return;
              }
              if (isLowPerf) {
                navigate(`/games/${game.id}`, {
                  state: {
                    resolvedSteamAppId: item.steamAppId,
                    catalogDisplayName: item.name,
                    from,
                  },
                });
                return;
              }
              startTransition(() => {
                addTransitionType("game-detail");
                navigate(`/games/${game.id}`, {
                  state: {
                    resolvedSteamAppId: item.steamAppId,
                    catalogDisplayName: item.name,
                    from,
                  },
                });
              });
            }}
          />
        </div>
        <div className="min-h-8 space-y-2">
          {isMatchingPending ? (
            <div
              className={cn(
                "w-full rounded-medium bg-linear-to-r from-default-200/70 via-default-100/50 to-default-200/70 bg-size-[200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]",
                consoleMode ? "h-11 rounded-xl" : "h-8"
              )}
            />
          ) : libraryGame ? (
            <Button
              size={consoleMode ? "md" : "sm"}
              color="success"
              variant="flat"
              className={cn(
                "w-full font-semibold border-success-300/60 dark:border-success-500/30 transition-colors duration-150",
                consoleMode ? "h-11 text-base rounded-xl" : "h-8 text-xs rounded-medium"
              )}>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-success-500 animate-pulse" />
                En Biblioteca
              </span>
            </Button>
          ) : best ? (
            <>
              {candidates.length > 1 ? (
                <Select
                  size={consoleMode ? "lg" : "sm"}
                  variant="bordered"
                  className="w-full"
                  placeholder={best ? `${best.source_name} — ${best.item_title}` : "Fuente"}
                  aria-label={`Elegir fuente para ${item.name}`}
                  selectionMode="single"
                  selectedKeys={new Set([selectKey ?? sourceCandidateKey(best)])}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    onPickChange(item.name, next !== undefined ? String(next) : sourceCandidateKey(best));
                  }}
                  maxListboxHeight={consoleMode ? 520 : undefined}
                  listboxProps={consoleMode ? CONSOLE_SOURCE_LISTBOX_PROPS : undefined}
                  classNames={
                    consoleMode
                      ? {
                          trigger: "h-12 min-h-12 rounded-xl text-base",
                          value: "text-base font-semibold",
                          listbox: "gap-0 p-0 text-base",
                          popoverContent: "min-w-[var(--trigger-width)] p-2 text-base",
                        }
                      : undefined
                  }>
                  {candidates.map((c) => (
                    <SelectItem key={sourceCandidateKey(c)} textValue={`${c.source_name} ${c.item_title}`}>
                      {c.source_name} — {c.item_title}
                    </SelectItem>
                  ))}
                </Select>
              ) : null}
              <Button
                size={consoleMode ? "md" : "sm"}
                color="primary"
                className={cn(
                  "w-full font-semibold tracking-wide shadow-sm shadow-primary/20 transition-all duration-150 hover:shadow-md hover:shadow-primary/30 hover:brightness-110 active:scale-[0.98]",
                  consoleMode ? "h-11 text-base rounded-xl" : "h-8 text-xs rounded-medium"
                )}
                onPress={() => onInstall(item.name)}>
                Instalar
              </Button>
            </>
          ) : (
            <p className={cn("pt-2 text-center text-default-400 font-medium", consoleMode ? "text-sm" : "text-xs")}>
              No disponible en tus fuentes
            </p>
          )}
        </div>
      </div>
    </GamesListMotionItem>
  );
});

type SteamCatalogGridProps = {
  items: CatalogListItem[];
  listKey: string;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  matchByGameName: Record<string, SourceBestMatch[]>;
  isMatchingPending: boolean;
  consoleMode?: boolean;
};

export function SteamCatalogGrid({
  items,
  listKey,
  mediaBySteamAppId,
  matchByGameName,
  isMatchingPending,
  consoleMode = false,
}: SteamCatalogGridProps) {
  const { config } = useConfig();
  const [pickByGame, setPickByGame] = useState<PickByGame>({});
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [installingGame, setInstallingGame] = useState<{
    name: string;
    size?: string | null;
    game: ConfiguredGame;
    chosen: SourceBestMatch;
  } | null>(null);

  const peerOffersHook = usePeerInstallOffers(installingGame?.game.steamAppId, isOpen && !!installingGame);

  const matchByGameNameRef = useRef(matchByGameName);
  const pickByGameRef = useRef(pickByGame);
  useEffect(() => {
    matchByGameNameRef.current = matchByGameName;
  }, [matchByGameName]);
  useEffect(() => {
    pickByGameRef.current = pickByGame;
  }, [pickByGame]);

  useEffect(() => {
    setPickByGame((prev) => {
      const next = { ...prev };
      for (const item of items) {
        const match = matchByGameName[item.name];
        const list = match ?? [];
        const best = list.length > 0 ? list[0] : undefined;

        if (best) {
          const currentPick = next[item.name];
          const isValidPick = currentPick && list.some((c) => sourceCandidateKey(c) === currentPick);

          if (!isValidPick) {
            next[item.name] = sourceCandidateKey(best);
          }
        } else {
          delete next[item.name];
        }
      }
      for (const k of Object.keys(next)) {
        if (!items.some((i) => i.name === k)) {
          delete next[k];
        }
      }
      return next;
    });
  }, [items, matchByGameName]);

  const handlePickChange = useCallback((gameName: string, key: string) => {
    setPickByGame((p) => ({ ...p, [gameName]: key }));
  }, []);

  const handleInstall = useCallback(
    async (gameName: string) => {
      const match = matchByGameNameRef.current[gameName];
      const chosen = pickCandidate(match, pickByGameRef.current[gameName]);
      if (!chosen) return;

      const item = items.find((i) => i.name === gameName);
      if (!item) return;

      setInstallingGame({
        name: gameName,
        size: chosen.file_size,
        game: catalogListItemToConfiguredGame(item),
        chosen,
      });
      onOpen();
    },
    [items, mediaBySteamAppId, onOpen]
  );

  const handleConfirmInstall = useCallback(
    async (selectedPath: string) => {
      if (!installingGame) return;
      const { name, chosen } = installingGame;

      try {
        await startSourceDownload({
          sourceId: chosen.source_id,
          itemId: chosen.item_id,
          destinationDir: selectedPath.trim(),
          preferredProtocol: null,
        });

        toastSuccess("Descarga iniciada", `Instalacion iniciada para ${name}.`);
      } catch (e) {
        toastError("No se pudo iniciar", e instanceof Error ? e.message : String(e));
      }
    },
    [installingGame]
  );

  const handleConfirmPeerInstall = useCallback(
    async (selectedPath: string, offer: PeerInstallOffer) => {
      if (!installingGame || !peerOffersHook.gameKey) return;
      const { name } = installingGame;

      try {
        await startPeerGameDownload({
          gameKey: peerOffersHook.gameKey,
          title: name,
          destinationDir: selectedPath.trim(),
          targetUserId: offer.userId,
          targetDeviceId: offer.deviceId,
          manifestHash: offer.manifestHash,
        });

        toastSuccess("Transferencia iniciada", `Traiendo ${name} desde ${offer.deviceName}.`);
      } catch (e) {
        toastError("No se pudo transferir", e instanceof Error ? e.message : String(e));
      }
    },
    [installingGame, peerOffersHook.gameKey]
  );

  return (
    <>
      <GamesListMotionContainer
        className={cn(
          "grid gap-5",
          consoleMode
            ? "grid-cols-[repeat(auto-fill,minmax(320px,1fr))]"
            : "grid-cols-[repeat(auto-fill,minmax(280px,1fr))]"
        )}
        listKey={listKey}>
        {items.map((item) => {
          const libraryGame = config?.games?.find(
            (g) => (g.steamAppId && g.steamAppId === item.steamAppId) || g.id.toLowerCase() === item.name.toLowerCase()
          );

          return (
            <CatalogGridItem
              key={item.name}
              item={item}
              libraryGame={libraryGame}
              mediaBySteamAppId={mediaBySteamAppId}
              match={matchByGameName[item.name]}
              selectKey={pickByGame[item.name]}
              isMatchingPending={isMatchingPending}
              onPickChange={handlePickChange}
              onInstall={handleInstall}
              consoleMode={consoleMode}
            />
          );
        })}
      </GamesListMotionContainer>

      {installingGame && (
        <InstallModal
          isOpen={isOpen}
          onOpenChange={onOpenChange}
          gameName={installingGame.name}
          gameSizeStr={installingGame.size}
          protocols={installingGame.chosen.protocols}
          game={installingGame.game}
          mediaBySteamAppId={mediaBySteamAppId}
          peerOffers={peerOffersHook.offers}
          selectedPeerDeviceId={peerOffersHook.selectedDeviceId}
          onSelectPeerDevice={peerOffersHook.setSelectedDeviceId}
          onConfirm={handleConfirmInstall}
          onConfirmPeer={handleConfirmPeerInstall}
          consoleMode={consoleMode}
        />
      )}
    </>
  );
}
