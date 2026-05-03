import { useCallback, useMemo, useState } from "react";
import { Button, Card, CardBody, Code } from "@heroui/react";
import { FolderSearch, Gamepad2, PlusCircle } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { useCloudBackupCounts } from "@hooks/useCloudBackupCounts";
import { useGameStats } from "@hooks/useGameStats";
import { useGameRunningStatus } from "@hooks/useGameRunningStatus";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { useGameMediaBatch, getIsResolvingIds } from "@hooks/useGameMedia";
import { needsSteamSearch } from "@utils/gameImage";
import { GameCard } from "@features/games/GameCard";
import { GamesListMotionContainer, GamesListMotionItem } from "@features/games/GamesListMotion";
import { GamesViewControls } from "@features/games/Gamesviewcontrols";
import { useGamesViewPreferences } from "@hooks/useGamesViewPreferences";
import { useGamesSorter } from "@hooks/Usegamessorter";

type SyncStatus = "pending_upload" | "pending_download" | "in_sync" | null;

/** Diferencia en ms por debajo de la cual consideramos local y nube "en sync" (precisión, reloj). */
const SYNC_TOLERANCE_MS = 15_000;
/** Si la nube es más reciente que local pero por menos de esto, lo tratamos como "en sync" */
const CLOUD_NEWER_AS_SYNC_MS = 120_000;

function getSyncStatus(gameId: string, stats: GameStats | undefined, unsyncedGameIds: string[]): SyncStatus {
  if (unsyncedGameIds.includes(gameId)) return "pending_upload";
  if (!stats?.cloudLastModified) return null;
  const cloud = new Date(stats.cloudLastModified).getTime();
  const local = stats.localLastModified ? new Date(stats.localLastModified).getTime() : 0;
  const diff = cloud - local;
  if (diff > CLOUD_NEWER_AS_SYNC_MS) return "pending_download";
  if (local > 0 || Math.abs(diff) <= SYNC_TOLERANCE_MS || (diff > 0 && diff <= CLOUD_NEWER_AS_SYNC_MS))
    return "in_sync";
  return null;
}

function getGridClass(layout: "grid-lg" | "grid-md" | "list"): string {
  switch (layout) {
    case "grid-lg":
      return "grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5";

    case "grid-md":
      return "grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-5";

    case "list":
      return "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";
  }
}

interface GamesListProps {
  games: readonly ConfiguredGame[];
  /** Clave para re-ejecutar la animación de entrada al filtrar/buscar, incluso si los IDs no cambian. */
  animationKey?: string;
  /** Mensaje cuando la lista está vacía por filtros (en lugar del mensaje por defecto). */
  emptyFilterMessage?: string;
  /** Juegos con guardados locales sin subir (para badge). */
  unsyncedGameIds?: string[];
  /** Callback cuando no hay juegos: pulsar Analizar rutas. */
  onEmptyScanPress?: () => void;
  /** Callback cuando no hay juegos: pulsar Añadir juego. */
  onEmptyAddPress?: () => void;
  /** Callback al eliminar un juego. Si no se pasa, no se muestra el botón de eliminar. */
  onRemove?: (game: ConfiguredGame) => void;
  /** Callback al sincronizar (subir) un juego. Si no se pasa, no se muestra el botón. */
  onSync?: (game: ConfiguredGame) => void;
  /** ID del juego que está sincronizando (muestra spinner). */
  syncingId?: string | null;
  /** ID del juego que está descargando (spinner en Traer guardados + barra global). */
  downloadingId?: string | null;
  /** Callback al abrir la carpeta de guardados. */
  onOpenFolder?: (game: ConfiguredGame) => void;
  /** Abre el modal Traer guardados */
  onRecoverFromCloud?: (game: ConfiguredGame) => void;
  /** Callback para empaquetar y subir (backup completo). */
  onFullBackupUpload?: (game: ConfiguredGame) => void;
  /** ID del juego que está empaquetando/subiendo backup completo. */
  fullBackupUploadingGameId?: string | null;
  /** Callback para editar el juego. */
  onEdit?: (game: ConfiguredGame) => void;
  /** Callback para abrir el panel de torrent. */
  onTorrent?: (game: ConfiguredGame) => void;
  /** Callback para compartir por link. */
  onShare?: (game: ConfiguredGame) => void;
  /** Si hay configuración de nube (para cargar conteo de backups empaquetados). */
  hasSyncConfig?: boolean;
  /** Big Picture / mando: barra de orden y vista más grande. */
  consoleMode?: boolean;
}

export function GamesList({
  games,
  animationKey,
  emptyFilterMessage,
  unsyncedGameIds = [],
  onEmptyScanPress,
  onEmptyAddPress,
  onRemove,
  onSync,
  syncingId,
  downloadingId,
  onOpenFolder,
  onRecoverFromCloud,
  onFullBackupUpload,
  fullBackupUploadingGameId,
  onEdit,
  onTorrent,
  onShare,
  hasSyncConfig = false,
  consoleMode = false,
}: GamesListProps) {
  const { layout, sortBy, sortDir, setLayout, setSortBy, setSortDir } = useGamesViewPreferences();

  const handleSortChange = useCallback(
    (field: typeof sortBy, dir: typeof sortDir) => {
      setSortBy(field);
      setSortDir(dir);
    },
    [setSortBy, setSortDir]
  );

  const resolvedSteamAppIds = useResolvedSteamAppIds(games);
  const isResolvingIds = getIsResolvingIds(games, resolvedSteamAppIds);
  const { mediaBySteamAppId } = useGameMediaBatch({ games, resolvedSteamAppIds, isResolvingIds });
  const { statsByGameId } = useGameStats(games.length > 0);
  const { countByGameId: cloudBackupCountByGameId } = useCloudBackupCounts(
    games.map((g) => g.id),
    hasSyncConfig && games.length > 0
  );
  const gameRunningStatus = useGameRunningStatus(games.map((g) => g.id));

  const sortedGames = useGamesSorter(games, statsByGameId as unknown as Map<string, GameStats>, sortBy, sortDir);

  const stableListKey = useMemo(
    () => [animationKey ?? "", layout, sortBy, sortDir, sortedGames.map((g) => g.id).join(",")].join("|"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [animationKey, layout, sortBy, sortDir, sortedGames.map((g) => g.id).join(",")]
  );

  const [openActionsGameId, setOpenActionsGameId] = useState<string | null>(null);
  const handleActionsMenuOpenChange = useCallback((open: boolean, gameId: string) => {
    setOpenActionsGameId(open ? gameId : null);
  }, []);

  if (games.length === 0) {
    const isEmptyState = !emptyFilterMessage;
    return (
      <>
        {/* Siempre mostramos los controles aunque la lista esté vacía */}
        <div className={`mb-4 flex w-full items-center ${consoleMode ? "" : "justify-end"}`}>
          <GamesViewControls
            sortBy={sortBy}
            sortDir={sortDir}
            layout={layout}
            onSortChange={handleSortChange}
            onLayoutChange={setLayout}
            consoleMode={consoleMode}
          />
        </div>
        <Card className="border border-dashed border-default-300">
          <CardBody className="flex flex-col items-center gap-6 py-14 text-center">
            <Gamepad2 size={56} className="text-default-400" strokeWidth={1.5} />
            <div className="space-y-2">
              <p className="text-lg font-medium text-default-700">
                {emptyFilterMessage ?? "Aún no tienes juegos configurados"}
              </p>
              {emptyFilterMessage ? (
                <p className="text-sm text-default-500">{emptyFilterMessage}</p>
              ) : (
                <p className="max-w-sm text-sm text-default-500">
                  Escanea tu PC para detectar carpetas de guardados o añade un juego manualmente con su ruta.
                </p>
              )}
            </div>
            {isEmptyState && (onEmptyScanPress || onEmptyAddPress) && (
              <div className="flex flex-wrap items-center justify-center gap-3">
                {onEmptyScanPress && (
                  <Button
                    color="primary"
                    variant="bordered"
                    startContent={<FolderSearch size={18} />}
                    onPress={onEmptyScanPress}>
                    Buscar juegos automáticamente
                  </Button>
                )}
                {onEmptyAddPress && (
                  <Button color="primary" startContent={<PlusCircle size={18} />} onPress={onEmptyAddPress}>
                    Añadir juego
                  </Button>
                )}
              </div>
            )}
            {!isEmptyState && !onEmptyScanPress && (
              <p className="text-xs text-default-400">
                <Code>savecloud add &lt;game-id&gt; &lt;ruta&gt;</Code>
              </p>
            )}
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div
        className={[
          "flex flex-wrap items-center gap-3",
          consoleMode
            ? "flex-col items-stretch gap-4 sm:flex-row sm:items-center sm:justify-between"
            : "justify-between",
        ].join(" ")}>
        <p className={consoleMode ? "text-base font-semibold text-default-400 md:text-lg" : "text-xs text-default-400"}>
          {sortedGames.length} {sortedGames.length === 1 ? "juego" : "juegos"}
        </p>
        <GamesViewControls
          sortBy={sortBy}
          sortDir={sortDir}
          layout={layout}
          onSortChange={handleSortChange}
          onLayoutChange={setLayout}
          consoleMode={consoleMode}
        />
      </div>

      {/* Game grid / list */}
      <GamesListMotionContainer className={getGridClass(layout)} listKey={stableListKey}>
        {sortedGames.map((game) => (
          <GamesListMotionItem key={game.id}>
            <GameCard
              game={game}
              stats={statsByGameId.get(game.id) as GameStats | undefined}
              resolvedSteamAppId={resolvedSteamAppIds[game.id]}
              mediaBySteamAppId={mediaBySteamAppId ?? null}
              mediaFromBatch
              isGameRunning={gameRunningStatus[game.id] ?? false}
              syncStatus={(() => {
                const status = getSyncStatus(
                  game.id,
                  statsByGameId.get(game.id) as GameStats | undefined,
                  unsyncedGameIds
                );
                const cloudBackups = cloudBackupCountByGameId[game.id] ?? 0;
                if (status === "pending_upload" && cloudBackups > 0) return null;
                return status;
              })()}
              cloudBackupCount={cloudBackupCountByGameId[game.id] ?? 0}
              isLoading={needsSteamSearch(game) && resolvedSteamAppIds[game.id] === undefined}
              onRemove={onRemove}
              onSync={onSync}
              isSyncing={syncingId === game.id || syncingId === "all"}
              isDownloading={downloadingId === game.id || downloadingId === "all"}
              onOpenFolder={onOpenFolder}
              onRecoverFromCloud={onRecoverFromCloud}
              onFullBackupUpload={onFullBackupUpload}
              isFullBackupUploading={fullBackupUploadingGameId === game.id}
              onEdit={onEdit}
              onTorrent={onTorrent}
              onShare={onShare}
              actionsMenuOpen={openActionsGameId === game.id}
              onActionsMenuOpenChange={handleActionsMenuOpenChange}
            />
          </GamesListMotionItem>
        ))}
      </GamesListMotionContainer>
    </div>
  );
}
