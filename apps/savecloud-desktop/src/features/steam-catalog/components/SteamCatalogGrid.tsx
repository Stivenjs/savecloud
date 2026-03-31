import type { CatalogListItem } from "@services/tauri";
import type { SteamAppdetailsMediaResult } from "@services/tauri";
import type { SourceMatchResult } from "@services/tauri";
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
  defaultDownloadDir: string;
};

export function SteamCatalogGrid({
  items,
  listKey,
  mediaBySteamAppId,
  matchByGameName,
  defaultDownloadDir,
}: SteamCatalogGridProps) {
  const handleInstall = async (gameName: string) => {
    const match = matchByGameName[gameName];
    const best = match?.best;
    if (!best) return;
    if (!defaultDownloadDir.trim()) {
      toastError("Falta carpeta de descarga", "Configura la carpeta por defecto en Configuracion.");
      return;
    }
    try {
      await startSourceDownload({
        sourceId: best.sourceId,
        itemId: best.itemId,
        destinationDir: defaultDownloadDir.trim(),
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
              {match?.best ? (
                <Button size="sm" color="primary" className="w-full" onPress={() => void handleInstall(item.name)}>
                  Instalar
                </Button>
              ) : (
                <p className="text-center text-xs text-default-400">No disponible en tus fuentes</p>
              )}
            </div>
          </GamesListMotionItem>
        );
      })}
    </GamesListMotionContainer>
  );
}
