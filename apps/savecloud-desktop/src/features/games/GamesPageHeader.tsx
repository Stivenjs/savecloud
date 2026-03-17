import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner } from "@heroui/react";
import { ChevronDown, CloudDownload, CloudUpload, FolderSearch, PlusCircle, RefreshCw } from "lucide-react";

interface GamesPageHeaderProps {
  hasSyncConfig: boolean;
  gamesCount: number;
  syncing: string | "all" | null;
  downloading: string | "all" | null;
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
  syncing,
  downloading,
  onScanPress,
  onAddPress,
  onDownloadAllPress,
  onSyncAllPress,
  onRefreshPress,
  isRefreshing = false,
}: GamesPageHeaderProps) {
  const isOperationRunning = !!syncing || !!downloading;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="bordered" startContent={<FolderSearch size={18} />} onPress={onScanPress}>
          Analizar rutas
        </Button>
        <Button variant="flat" color="primary" startContent={<PlusCircle size={18} />} onPress={onAddPress}>
          Añadir juego
        </Button>
        {hasSyncConfig && (
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <Button
                variant="solid"
                color="secondary"
                endContent={<ChevronDown size={16} />}
                isDisabled={!gamesCount || isOperationRunning}>
                Acciones rápidas
              </Button>
            </DropdownTrigger>
            <DropdownMenu aria-label="Acciones rápidas">
              <DropdownItem
                key="download-all"
                startContent={
                  downloading === "all" ? <Spinner size="sm" color="current" /> : <CloudDownload size={16} />
                }
                onPress={onDownloadAllPress}
                isDisabled={!gamesCount || isOperationRunning}>
                Descargar todos
              </DropdownItem>
              <DropdownItem
                key="upload-all"
                startContent={syncing === "all" ? <Spinner size="sm" color="current" /> : <CloudUpload size={16} />}
                onPress={onSyncAllPress}
                isDisabled={!gamesCount || isOperationRunning}>
                Subir todos
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        )}
        <Button
          variant="solid"
          startContent={!isRefreshing ? <RefreshCw size={18} /> : undefined}
          onPress={onRefreshPress}
          isLoading={isRefreshing}
          isDisabled={isRefreshing}>
          Actualizar
        </Button>
      </div>
    </div>
  );
}
