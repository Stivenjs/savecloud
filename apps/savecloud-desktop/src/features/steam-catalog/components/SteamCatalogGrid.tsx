import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CatalogListItem } from "@services/tauri";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import type { SourceMatchResult } from "@services/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { GameCard } from "@features/games/GameCard";
import { GamesListMotionContainer, GamesListMotionItem } from "@features/games/GamesListMotion";
import { catalogListItemToConfiguredGame } from "@features/steam-catalog/model/catalogConfiguredGame";
import { Button, Select, SelectItem } from "@heroui/react";
import { startSourceDownload } from "@services/tauri";
import { pickCandidate, sourceCandidateKey } from "@utils/sourceMatch";
import { toastError, toastSuccess } from "@utils/toast";

type PickByGame = Record<string, string>;

type CatalogGridItemProps = {
  item: CatalogListItem;
  mediaBySteamAppId: Record<string, SteamAppdetailsMediaResult> | null;
  match: SourceMatchResult | undefined;
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
  mediaBySteamAppId,
  match,
  selectKey,
  isMatchingPending,
  onPickChange,
  onInstall,
}: CatalogGridItemProps) {
  const game = catalogListItemToConfiguredGame(item);
  const candidates = match?.candidates ?? [];
  const best = match?.best;

  return (
    <GamesListMotionItem key={game.id}>
      <div className="space-y-2">
        <GameCard
          variant="catalog"
          game={game}
          cardTitle={item.name}
          mediaBySteamAppId={mediaBySteamAppId ?? null}
          mediaFromBatch
        />
        <div className="min-h-8 space-y-2">
          {isMatchingPending ? (
            <div className="h-8 w-full animate-pulse rounded-medium bg-default-200/70" />
          ) : best ? (
            <>
              {candidates.length > 1 ? (
                <Select
                  size="sm"
                  variant="bordered"
                  className="w-full"
                  placeholder="Fuente"
                  aria-label={`Elegir fuente para ${item.name}`}
                  selectionMode="single"
                  selectedKeys={new Set([selectKey ?? sourceCandidateKey(best)])}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    onPickChange(item.name, next !== undefined ? String(next) : sourceCandidateKey(best));
                  }}>
                  {candidates.map((c) => (
                    <SelectItem key={sourceCandidateKey(c)} textValue={`${c.sourceName} ${c.itemTitle}`}>
                      {c.sourceName} — {c.itemTitle}
                    </SelectItem>
                  ))}
                </Select>
              ) : null}
              <Button size="sm" color="primary" className="h-8 w-full" onPress={() => onInstall(item.name)}>
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
  matchByGameName: Record<string, SourceMatchResult>;
  isMatchingPending: boolean;
};

export function SteamCatalogGrid({
  items,
  listKey,
  mediaBySteamAppId,
  matchByGameName,
  isMatchingPending,
}: SteamCatalogGridProps) {
  const [pickByGame, setPickByGame] = useState<PickByGame>({});

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
        const list = match?.candidates ?? [];
        const best = match?.best;
        if (!best || list.length === 0) {
          delete next[item.name];
          continue;
        }
        const cur = next[item.name];
        const valid = cur !== undefined && list.some((c) => sourceCandidateKey(c) === cur);
        if (!valid) {
          next[item.name] = sourceCandidateKey(best);
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

  const handleInstall = useCallback(async (gameName: string) => {
    const match = matchByGameNameRef.current[gameName];
    const chosen = pickCandidate(match?.candidates, pickByGameRef.current[gameName]);
    if (!chosen) return;

    const selectedPath = await open({
      title: `Seleccionar carpeta para ${gameName}`,
      directory: true,
      multiple: false,
    });
    if (!selectedPath || typeof selectedPath !== "string") return;

    try {
      await startSourceDownload({
        sourceId: chosen.sourceId,
        itemId: chosen.itemId,
        destinationDir: selectedPath.trim(),
        preferredProtocol: null,
      });
      toastSuccess("Descarga iniciada", `Instalacion iniciada para ${gameName}.`);
    } catch (e) {
      toastError("No se pudo iniciar", e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <GamesListMotionContainer className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5" listKey={listKey}>
      {items.map((item) => (
        <CatalogGridItem
          key={item.name}
          item={item}
          mediaBySteamAppId={mediaBySteamAppId}
          match={matchByGameName[item.name]}
          selectKey={pickByGame[item.name]}
          isMatchingPending={isMatchingPending}
          onPickChange={handlePickChange}
          onInstall={handleInstall}
        />
      ))}
    </GamesListMotionContainer>
  );
}
