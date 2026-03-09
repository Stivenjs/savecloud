import { Button, Card, CardBody, Code } from "@heroui/react";
import { FolderSearch, Gamepad2, PlusCircle } from "lucide-react";
import type { ConfiguredGame } from "@app-types/config";
import type { GameStats } from "@services/tauri";
import { useCloudBackupCounts } from "@hooks/useCloudBackupCounts";
import { useGameStats } from "@hooks/useGameStats";
import { useGameRunningStatus } from "@hooks/useGameRunningStatus";
import { useResolvedSteamAppIds } from "@hooks/useResolvedSteamAppIds";
import { useSyncProgress } from "@contexts/SyncProgressContext";
import { needsSteamSearch } from "@utils/gameImage";
import { GameCard } from "@features/games/GameCard";

type SyncStatus = "pending_upload" | "pending_download" | "in_sync" | null;

/** Diferencia en ms por debajo de la cual consideramos local y nube "en sync" (precisión, reloj). */
const SYNC_TOLERANCE_MS = 15_000; // 15 segundos
/** Si la nube es más reciente que local pero por menos de esto, lo tratamos como "en sync":
 *  tras subir, S3 pone LastModified = ahora, así que cloud > local; no queremos mostrar "Pendiente descargar". */
const CLOUD_NEWER_AS_SYNC_MS = 120_000; // 2 minutos

function getSyncStatus(
  gameId: string,
  stats: GameStats | undefined,
  unsyncedGameIds: string[]
): SyncStatus {
  if (unsyncedGameIds.includes(gameId)) return "pending_upload";
  if (!stats?.cloudLastModified) return null;
  const cloud = new Date(stats.cloudLastModified).getTime();
  const local = stats.localLastModified
    ? new Date(stats.localLastModified).getTime()
    : 0;
  const diff = cloud - local;
  // Solo "pendiente descargar" si la nube es claramente más reciente (p. ej. otro dispositivo subió).
  // Si la diferencia es pequeña (p. ej. tras subir nosotros, S3 = ahora, local = antes) → in_sync.
  if (diff > CLOUD_NEWER_AS_SYNC_MS) return "pending_download";
  // Local más reciente, o diferencia dentro de tolerancia, o nube un poco más reciente (subida reciente) → en sync.
  if (local > 0 || Math.abs(diff) <= SYNC_TOLERANCE_MS || (diff > 0 && diff <= CLOUD_NEWER_AS_SYNC_MS)) return "in_sync";
  return null;
}

interface GamesListProps {
  games: readonly ConfiguredGame[];
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
  /** Callback al descargar un juego. Si no se pasa, no se muestra el botón. */
  onDownload?: (game: ConfiguredGame) => void;
  /** ID del juego que está descargando (muestra spinner). */
  downloadingId?: string | null;
  /** Callback al abrir la carpeta de guardados. */
  onOpenFolder?: (game: ConfiguredGame) => void;
  /** Callback para restaurar desde backup. */
  onRestoreBackup?: (game: ConfiguredGame) => void;
  /** Callback para empaquetar y subir (backup completo). */
  onFullBackupUpload?: (game: ConfiguredGame) => void;
  /** ID del juego que está empaquetando/subiendo backup completo. */
  fullBackupUploadingGameId?: string | null;
  /** Callback para editar el juego. */
  onEdit?: (game: ConfiguredGame) => void;
  /** Callback para compartir por link. */
  onShare?: (game: ConfiguredGame) => void;
  /** Si hay configuración de nube (para cargar conteo de backups empaquetados). */
  hasSyncConfig?: boolean;
}

export function GamesList({
  games,
  emptyFilterMessage,
  unsyncedGameIds = [],
  onEmptyScanPress,
  onEmptyAddPress,
  onRemove,
  onSync,
  syncingId,
  onDownload,
  downloadingId,
  onOpenFolder,
  onRestoreBackup,
  onFullBackupUpload,
  fullBackupUploadingGameId,
  onEdit,
  onShare,
  hasSyncConfig = false,
}: GamesListProps) {
  const resolvedSteamAppIds = useResolvedSteamAppIds(games);
  const { statsByGameId } = useGameStats(games.length > 0);
  const { countByGameId: cloudBackupCountByGameId } = useCloudBackupCounts(
    games.map((g) => g.id),
    hasSyncConfig && games.length > 0
  );
  const gameRunningStatus = useGameRunningStatus(
    games.map((g) => g.id)
  );
  const { syncOperation, progress } = useSyncProgress();

  if (games.length === 0) {
    const isEmptyState = !emptyFilterMessage;
    return (
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
                Escanea tu PC para detectar carpetas de guardados o añade un
                juego manualmente con su ruta.
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
                  onPress={onEmptyScanPress}
                >
                  Analizar rutas
                </Button>
              )}
              {onEmptyAddPress && (
                <Button
                  color="primary"
                  startContent={<PlusCircle size={18} />}
                  onPress={onEmptyAddPress}
                >
                  Añadir juego
                </Button>
              )}
            </div>
          )}
          {!isEmptyState && !onEmptyScanPress && (
            <p className="text-xs text-default-400">
              <Code>sync-games add &lt;game-id&gt; &lt;ruta&gt;</Code>
            </p>
          )}
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
          syncStatus={(() => {
            const status = getSyncStatus(
              game.id,
              statsByGameId.get(game.id),
              unsyncedGameIds
            );
            // Si tiene backup empaquetado en la nube, no mostrar "Pendiente subir"
            const cloudBackups = cloudBackupCountByGameId[game.id] ?? 0;
            if (status === "pending_upload" && cloudBackups > 0) return null;
            return status;
          })()}
          cloudBackupCount={cloudBackupCountByGameId[game.id] ?? 0}
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
          onFullBackupUpload={onFullBackupUpload}
          isFullBackupUploading={fullBackupUploadingGameId === game.id}
          onEdit={onEdit}
          onShare={onShare}
          syncProgress={
            syncOperation?.mode === "single" && syncOperation.gameId === game.id
              ? progress ?? null
              : undefined
          }
        />
      ))}
    </div>
  );
}
