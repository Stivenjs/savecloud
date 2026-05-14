import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CatalogListItem } from "@services/tauri";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import type { SourceBestMatch } from "@services/tauri";
import { GameCard } from "@features/games/GameCard";
import { GamesListMotionContainer, GamesListMotionItem } from "@features/games/GamesListMotion";
import { catalogListItemToConfiguredGame } from "@features/steam-catalog/model/catalogConfiguredGame";
import { getGameImageUrl } from "@utils/gameImage";
import { Button, Select, SelectItem } from "@heroui/react";
import { startSourceDownload } from "@services/tauri";
import { pickCandidate, sourceCandidateKey } from "@utils/sourceMatch";
import { toastError, toastSuccess } from "@utils/toast";
import { useNavigate } from "react-router-dom";
import { useConfig } from "@hooks/useConfig";
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
}: CatalogGridItemProps) {
  const game = libraryGame ?? catalogListItemToConfiguredGame(item);
  const navigate = useNavigate();
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
            onCardNavigate={libraryGame ? () => navigate(`/games/${libraryGame.id}`) : undefined}
          />
        </div>
        <div className="min-h-8 space-y-2">
          {isMatchingPending ? (
            <div
              className="h-8 w-full rounded-medium 
                    bg-linear-to-r from-default-200/70 via-default-100/50 to-default-200/70 
                    bg-size-[200%_100%] animate-[shimmer_1.5s_ease-in-out_infinite]"
            />
          ) : libraryGame ? (
            <Button
              size="sm"
              color="success"
              variant="flat"
              className="h-8 w-full font-medium 
                 border-success-300/60 dark:border-success-500/30
                 transition-colors duration-150">
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-success-500 animate-pulse" />
                En Biblioteca
              </span>
            </Button>
          ) : best ? (
            <>
              {candidates.length > 1 ? (
                <Select
                  size="sm"
                  variant="bordered"
                  className="w-full"
                  placeholder={best ? `${best.source_name} — ${best.item_title}` : "Fuente"}
                  aria-label={`Elegir fuente para ${item.name}`}
                  selectionMode="single"
                  selectedKeys={new Set([selectKey ?? sourceCandidateKey(best)])}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    onPickChange(item.name, next !== undefined ? String(next) : sourceCandidateKey(best));
                  }}>
                  {candidates.map((c) => (
                    <SelectItem key={sourceCandidateKey(c)} textValue={`${c.source_name} ${c.item_title}`}>
                      {c.source_name} — {c.item_title}
                    </SelectItem>
                  ))}
                </Select>
              ) : null}
              <Button
                size="sm"
                color="primary"
                className="h-8 w-full font-semibold tracking-wide 
                 shadow-sm shadow-primary/20 
                 transition-all duration-150
                 hover:shadow-md hover:shadow-primary/30 
                 hover:brightness-110 active:scale-[0.98]"
                onPress={() => onInstall(item.name)}>
                Instalar
              </Button>
            </>
          ) : (
            <p className="pt-2 text-center text-xs text-default-400">No disponible en tus fuentes</p>
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
};

export function SteamCatalogGrid({
  items,
  listKey,
  mediaBySteamAppId,
  matchByGameName,
  isMatchingPending,
}: SteamCatalogGridProps) {
  const { config } = useConfig();
  const [pickByGame, setPickByGame] = useState<PickByGame>({});
  const { isOpen, onOpen, onOpenChange } = useDisclosure();
  const [installingGame, setInstallingGame] = useState<{
    name: string;
    size?: string | null;
    image?: string | null;
    chosen: SourceBestMatch;
  } | null>(null);

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
      const catalogGame = item ? catalogListItemToConfiguredGame(item) : null;
      const cdnOrConfiguredCover = catalogGame ? getGameImageUrl(catalogGame) : null;
      const media = item?.steamAppId ? mediaBySteamAppId?.[item.steamAppId] : null;

      setInstallingGame({
        name: gameName,
        size: chosen.file_size,
        image: cdnOrConfiguredCover || media?.capsuleImage || media?.mediaUrls?.[0] || null,
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

  return (
    <>
      <GamesListMotionContainer
        className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5"
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
          gameImage={installingGame.image}
          onConfirm={handleConfirmInstall}
        />
      )}
    </>
  );
}
