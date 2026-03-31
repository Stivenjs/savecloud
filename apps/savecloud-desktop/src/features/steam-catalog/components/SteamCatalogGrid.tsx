import type { CatalogListItem } from "@services/tauri";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import type { SourceMatchResult } from "@services/tauri";
import { open } from "@tauri-apps/plugin-dialog";
import { GameCard } from "@features/games/GameCard";
import { GamesListMotionContainer, GamesListMotionItem } from "@features/games/GamesListMotion";
import { catalogListItemToConfiguredGame } from "@features/steam-catalog/model/catalogConfiguredGame";
import { Button } from "@heroui/react";
import { startSourceDownload } from "@services/tauri";
import { toastError, toastSuccess } from "@utils/toast";

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
  const handleInstall = async (gameName: string) => {
    const match = matchByGameName[gameName];
    const best = match?.best;
    if (!best) return;

    const selectedPath = await open({
      title: `Seleccionar carpeta para ${gameName}`,
      directory: true,
      multiple: false,
    });
    if (!selectedPath || typeof selectedPath !== "string") {
      return;
    }

    try {
      await startSourceDownload({
        sourceId: best.sourceId,
        itemId: best.itemId,
        destinationDir: selectedPath.trim(),
        preferredProtocol: null,
      });
      toastSuccess("Descarga iniciada", `Instalacion iniciada para ${gameName}.`);
    } catch (e) {
      toastError("No se pudo iniciar", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <GamesListMotionContainer className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5" listKey={listKey}>
      {items.map((item) => {
        const game = catalogListItemToConfiguredGame(item);
        const match = matchByGameName[item.name];
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
              <div className="h-8">
                {isMatchingPending ? (
                  <div className="h-full w-full animate-pulse rounded-medium bg-default-200/70" />
                ) : match?.best ? (
                  <Button
                    size="sm"
                    color="primary"
                    className="h-full w-full"
                    onPress={() => void handleInstall(item.name)}>
                    Instalar
                  </Button>
                ) : (
                  <p className="pt-2 text-center text-xs text-default-400">No disponible en tus fuentes</p>
                )}
              </div>
            </div>
          </GamesListMotionItem>
        );
      })}
    </GamesListMotionContainer>
  );
}
