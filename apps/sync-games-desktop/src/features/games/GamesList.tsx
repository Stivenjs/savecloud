import { Card, CardBody, Code } from "@heroui/react";
import { Gamepad2 } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import { useGameStats } from "@hooks/useGameStats";
import { useGameRunningStatus } from "@hooks/useGameRunningStatus";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { needsSteamSearch } from "@utils/gameImage";
import { GameCard } from "@features/games/GameCard";

interface GamesListProps {
  games: readonly ConfiguredGame[];
  /** Mensaje cuando la lista está vacía por filtros (en lugar del mensaje por defecto). */
  emptyFilterMessage?: string;
  /** Callback al eliminar un juego. Si no se pasa, no se muestra el botón de eliminar. */
  onRemove?: (game: ConfiguredGame) => void;
  /** Callback al sincronizar (subir) un juego. Si no se pasa, no se muestra el botón. */
  onSync?: (game: ConfiguredGame) => void;
  /** ID del juego que está sincronizando (muestra spinner). */
  syncingId?: string | null;
  /** Callback al descargar un juego. Si no se pasa, no se muestra el botón. */
  onDownload?: (game: ConfiguredGame) => void;
  /** ID del juego que está descargando (muestra spinner). */
  downloadingId?: string | null;
  /** Callback al abrir la carpeta de guardados. */
  onOpenFolder?: (game: ConfiguredGame) => void;
  /** Callback para restaurar desde backup. */
  onRestoreBackup?: (game: ConfiguredGame) => void;
}

export function GamesList({
  games,
  emptyFilterMessage,
  onRemove,
  onSync,
  syncingId,
  onDownload,
  downloadingId,
  onOpenFolder,
  onRestoreBackup,
}: GamesListProps) {
  const resolvedSteamAppIds = useResolvedSteamAppIds(games);
  const { statsByGameId } = useGameStats(games.length > 0);
  const gameRunningStatus = useGameRunningStatus(
    games.map((g) => g.id)
  );

  if (games.length === 0) {
    return (
      <Card className="border border-dashed border-default-300">
        <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
          <Gamepad2 size={48} className="text-default-400" strokeWidth={1.5} />
          <div>
            <p className="text-default-500">
              {emptyFilterMessage ?? "No hay juegos configurados."}
            </p>
            {!emptyFilterMessage && (
              <p className="mt-2 text-sm text-default-400">
                Añade juegos desde la línea de comandos con:{" "}
                <Code>sync-games add &lt;game-id&gt; &lt;ruta&gt;</Code>
              </p>
            )}
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
      {games.map((game) => (
        <GameCard
          game={game}
          key={game.id}
          stats={statsByGameId.get(game.id)}
          resolvedSteamAppId={resolvedSteamAppIds[game.id]}
          isGameRunning={gameRunningStatus[game.id]}
          isLoading={
            needsSteamSearch(game) && resolvedSteamAppIds[game.id] === undefined
          }
          onRemove={onRemove}
          onSync={onSync}
          isSyncing={syncingId === game.id || syncingId === "all"}
          onDownload={onDownload}
          isDownloading={downloadingId === game.id || downloadingId === "all"}
          onOpenFolder={onOpenFolder}
          onRestoreBackup={onRestoreBackup}
        />
      ))}
    </div>
  );
}
