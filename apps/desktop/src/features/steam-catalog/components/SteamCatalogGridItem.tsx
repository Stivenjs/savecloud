import { memo, startTransition } from "react";
import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { addTransitionType } from "react";
import { Button, Select, SelectItem, Skeleton, cn } from "@heroui/react";
import type { CatalogListItem, SteamAppdetailsMediaResult, SourceBestMatch } from "@services/tauri";
import type { ConfiguredGame } from "@app-types/config";
import { GameCard } from "@features/games/GameCard";
import { catalogListItemToConfiguredGame } from "@features/steam-catalog/model/catalogConfiguredGame";
import { useLowPerformanceMode } from "@hooks/useLowPerformanceMode";
import { sourceCandidateKey } from "@utils/sourceMatch";

export type CatalogGridItemProps = {
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

export const CatalogGridItem = memo(function CatalogGridItem({
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
  const { t } = useTranslation();
  const isLowPerf = useLowPerformanceMode();
  const game = libraryGame ?? catalogListItemToConfiguredGame(item);
  const navigate = useNavigate();
  const location = useLocation();
  const candidates = match ?? [];
  const best = candidates.length > 0 ? candidates[0] : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}>
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
            resolvedSteamAppId={item.steamAppId}
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
            <Skeleton className={cn("w-full", consoleMode ? "h-11 rounded-xl" : "h-8 rounded-medium")} />
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
                {t("steamCatalog.grid.inLibrary")}
              </span>
            </Button>
          ) : best ? (
            <>
              {candidates.length > 1 ? (
                <Select
                  size={consoleMode ? "lg" : "sm"}
                  variant="bordered"
                  className="w-full"
                  placeholder={best ? `${best.source_name} — ${best.item_title}` : t("steamCatalog.grid.source")}
                  aria-label={t("steamCatalog.grid.chooseSource", { name: item.name })}
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
                {t("steamCatalog.grid.install")}
              </Button>
            </>
          ) : (
            <p className={cn("pt-2 text-center text-default-400 font-medium", consoleMode ? "text-sm" : "text-xs")}>
              {t("steamCatalog.grid.notAvailable")}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
});
