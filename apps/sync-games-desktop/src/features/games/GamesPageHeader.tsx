import { Button, Spinner } from "@heroui/react";
import {
  CloudDownload,
  CloudUpload,
  FolderSearch,
  PlusCircle,
  RefreshCw,
} from "lucide-react";
import type { ConnectionStatus } from "@hooks/useLastSyncInfo";
import { ConnectionIndicator } from "@features/games/ConnectionIndicator";

interface GamesPageHeaderProps {
  hasSyncConfig: boolean;
  gamesCount: number;
  /** Número de juegos con guardados sin subir (muestra chip si > 0). */
  unsyncedCount?: number;
  syncing: string | "all" | null;
  downloading: string | "all" | null;
  connectionStatus?: ConnectionStatus;
  connectionError?: string | null;
  onConnectionRetry?: () => void;
  onScanPress: () => void;
  onAddPress: () => void;
  onDownloadAllPress: () => void;
  onSyncAllPress: () => void;
  onRefreshPress: () => void;
  /** Muestra spinner en el botón Actualizar. */
  isRefreshing?: boolean;
}

export function GamesPageHeader({
  hasSyncConfig,
  gamesCount,
  unsyncedCount = 0,
  syncing,
  downloading,
  connectionStatus = "idle",
  connectionError,
  onConnectionRetry,
  onScanPress,
  onAddPress,
  onDownloadAllPress,
  onSyncAllPress,
  onRefreshPress,
  isRefreshing = false,
}: GamesPageHeaderProps) {
  const isOperationRunning = !!syncing || !!downloading;

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold text-foreground">
            Juegos configurados
          </h1>
          {hasSyncConfig && unsyncedCount > 0 && (
            <span className="rounded-full bg-warning/20 px-3 py-1 text-sm font-medium text-warning">
              {unsyncedCount} con cambios sin subir
            </span>
          )}
          {hasSyncConfig && (
            <ConnectionIndicator
              status={connectionStatus}
              error={connectionError}
              onRetry={onConnectionRetry}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="bordered"
            startContent={<FolderSearch size={18} />}
            onPress={onScanPress}
          >
            Analizar rutas
          </Button>
          <Button
            variant="flat"
            color="primary"
            startContent={<PlusCircle size={18} />}
            onPress={onAddPress}
          >
            Añadir juego
          </Button>
          {hasSyncConfig && (
            <>
              <Button
                variant="solid"
                color="secondary"
                startContent={
                  downloading === "all" ? (
                    <Spinner size="sm" color="current" />
                  ) : (
                    <CloudDownload size={18} />
                  )
                }
                onPress={onDownloadAllPress}
                isDisabled={!gamesCount || isOperationRunning}
              >
                Descargar todos
              </Button>
              <Button
                variant="solid"
                color="secondary"
                startContent={
                  syncing === "all" ? (
                    <Spinner size="sm" color="current" />
                  ) : (
                    <CloudUpload size={18} />
                  )
                }
                onPress={onSyncAllPress}
                isDisabled={!gamesCount || isOperationRunning}
              >
                Subir todos
              </Button>
            </>
          )}
          <Button
            variant="solid"
            startContent={!isRefreshing ? <RefreshCw size={18} /> : undefined}
            onPress={onRefreshPress}
            isLoading={isRefreshing}
            isDisabled={isRefreshing}
          >
            Actualizar
          </Button>
        </div>
      </div>
    </header>
  );
}
