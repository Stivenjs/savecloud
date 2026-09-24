import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Button, Card, CardBody, Code } from "@heroui/react";
import { FolderSearch, Gamepad2, PlusCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { useCloudBackupCounts } from "@hooks/useCloudBackupCounts";
import { useGameStats } from "@hooks/useGameStats";
import { useGameRunningStatus } from "@hooks/useGameRunningStatus";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { useGameMediaBatch, getIsResolvingIds } from "@hooks/useGameMedia";
import { GamesListMotionContainer } from "@features/games/GamesListMotion";
import { GamesViewControls } from "@features/games/Gamesviewcontrols";
import { useGamesViewPreferences } from "@hooks/useGamesViewPreferences";
import { useGamesSorter } from "@hooks/Usegamessorter";
import { GamesVirtualizedGrid } from "@features/games/GamesVirtualizedGrid";

const GameConsoleActionsModal = lazy(() =>
  import("@features/games/GameConsoleActionsModal").then((m) => ({ default: m.GameConsoleActionsModal }))
);

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
  /** Callback para abrir el menú de acciones adaptado a consola (mando). */
  onOpenConsoleActions?: (game: ConfiguredGame) => void;
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
  onOpenConsoleActions,
}: GamesListProps) {
  const { t } = useTranslation();
  const { layout, cardOrientation, sortBy, sortDir, setLayout, setCardOrientation, setSortBy, setSortDir } =
    useGamesViewPreferences();

  const handleSortChange = useCallback(
    (field: typeof sortBy, dir: typeof sortDir) => {
      setSortBy(field);
      setSortDir(dir);
    },
    [setSortBy, setSortDir]
  );

  const gameIds = useMemo(() => games.map((g) => g.id), [games]);

  const resolvedSteamAppIds = useResolvedSteamAppIds(games);
  const isResolvingIds = getIsResolvingIds(games, resolvedSteamAppIds);
  const { mediaBySteamAppId } = useGameMediaBatch({ games, resolvedSteamAppIds, isResolvingIds });
  const { statsByGameId } = useGameStats(games.length > 0);
  const { countByGameId: cloudBackupCountByGameId } = useCloudBackupCounts(gameIds, hasSyncConfig && games.length > 0);
  const gameRunningStatus = useGameRunningStatus(gameIds);
  const unsyncedSet = useMemo(() => new Set(unsyncedGameIds), [unsyncedGameIds]);

  const sortedGames = useGamesSorter(games, statsByGameId as unknown as Map<string, GameStats>, sortBy, sortDir);

  const stableListKey = useMemo(
    () => [animationKey ?? "", layout, cardOrientation, sortBy, sortDir].join("|"),
    [animationKey, layout, cardOrientation, sortBy, sortDir]
  );

  const [openActionsGameId, setOpenActionsGameId] = useState<string | null>(null);
  const handleActionsMenuOpenChange = useCallback((open: boolean, gameId: string) => {
    setOpenActionsGameId(open ? gameId : null);
  }, []);

  const [consoleActionsGame, setConsoleActionsGame] = useState<ConfiguredGame | null>(null);
  const handleOpenConsoleActions = useCallback(
    (game: ConfiguredGame) => {
      if (onOpenConsoleActions) {
        onOpenConsoleActions(game);
      } else {
        setConsoleActionsGame(game);
      }
    },
    [onOpenConsoleActions]
  );

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
            cardOrientation={cardOrientation}
            onSortChange={handleSortChange}
            onLayoutChange={setLayout}
            onCardOrientationChange={setCardOrientation}
            consoleMode={consoleMode}
          />
        </div>
        <Card className="border border-dashed border-default-300">
          <CardBody className="flex flex-col items-center gap-6 py-14 text-center">
            <Gamepad2 size={56} className="text-default-400" strokeWidth={1.5} />
            <div className="space-y-2">
              <p className="text-lg font-medium text-default-700">
                {emptyFilterMessage ?? t("library.noGamesConfigured")}
              </p>
              {emptyFilterMessage ? (
                <p className="text-sm text-default-500">{emptyFilterMessage}</p>
              ) : (
                <p className="max-w-sm text-sm text-default-500">{t("library.scanOrAddHint")}</p>
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
                    {t("library.scan.autoScanTitle")}
                  </Button>
                )}
                {onEmptyAddPress && (
                  <Button color="primary" startContent={<PlusCircle size={18} />} onPress={onEmptyAddPress}>
                    {t("library.addGame")}
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
          {t("library.gamesCount", { count: sortedGames.length })}
        </p>
        <GamesViewControls
          sortBy={sortBy}
          sortDir={sortDir}
          layout={layout}
          cardOrientation={cardOrientation}
          onSortChange={handleSortChange}
          onLayoutChange={setLayout}
          onCardOrientationChange={setCardOrientation}
          consoleMode={consoleMode}
        />
      </div>

      {/* Game grid / list */}
      <GamesListMotionContainer listKey={stableListKey}>
        <GamesVirtualizedGrid
          games={sortedGames}
          layout={layout}
          cardOrientation={cardOrientation}
          consoleMode={consoleMode}
          statsByGameId={statsByGameId as unknown as Map<string, GameStats>}
          resolvedSteamAppIds={resolvedSteamAppIds}
          mediaBySteamAppId={mediaBySteamAppId ?? null}
          gameRunningStatus={gameRunningStatus}
          unsyncedSet={unsyncedSet}
          cloudBackupCountByGameId={cloudBackupCountByGameId}
          onRemove={onRemove}
          onSync={onSync}
          syncingId={syncingId}
          downloadingId={downloadingId}
          onOpenFolder={onOpenFolder}
          onRecoverFromCloud={onRecoverFromCloud}
          onFullBackupUpload={onFullBackupUpload}
          fullBackupUploadingGameId={fullBackupUploadingGameId}
          onEdit={onEdit}
          onTorrent={onTorrent}
          onShare={onShare}
          onOpenConsoleActions={handleOpenConsoleActions}
          openActionsGameId={openActionsGameId}
          onActionsMenuOpenChange={handleActionsMenuOpenChange}
        />
      </GamesListMotionContainer>

      {consoleActionsGame && (
        <Suspense fallback={null}>
          <GameConsoleActionsModal
            isOpen={!!consoleActionsGame}
            onClose={() => setConsoleActionsGame(null)}
            game={consoleActionsGame}
            surface="list"
            isGameRunning={gameRunningStatus[consoleActionsGame.id] ?? false}
            onEdit={onEdit}
            onTorrent={onTorrent}
            onOpenFolder={onOpenFolder}
            onSync={onSync}
            onFullBackupUpload={onFullBackupUpload}
            onRecoverFromCloud={onRecoverFromCloud}
            onShare={onShare}
            onRemove={onRemove}
            isSyncing={syncingId === consoleActionsGame.id || syncingId === "all"}
            isDownloading={downloadingId === consoleActionsGame.id || downloadingId === "all"}
            isFullBackupUploading={fullBackupUploadingGameId === consoleActionsGame.id}
          />
        </Suspense>
      )}
    </div>
  );
}
