import { useState } from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner } from "@heroui/react";
import { ChevronDown, CloudDownload, CloudUpload, Network, Search, Plus, Zap, RefreshCw } from "lucide-react";
import { useNavigable } from "@features/input/useNavigable";
import { useNavigationStore } from "@features/input/store";
import { getGamepadFocusClass } from "@features/input/styles";

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
  onSaveGraphPress: () => void;
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
  onSaveGraphPress,
  isRefreshing = false,
}: GamesPageHeaderProps) {
  const isOperationRunning = !!syncing || !!downloading;

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const { pushLayer, popLayer } = useNavigationStore();

  const handleDropdownChange = (isOpen: boolean) => {
    setIsDropdownOpen(isOpen);
    if (isOpen) {
      pushLayer("header-dropdown", "drop-download-all");
    } else {
      popLayer();
    }
  };

  const navScan = useNavigable({ id: "btn-scan", onPress: onScanPress });
  const navAdd = useNavigable({ id: "btn-add", onPress: onAddPress });
  const navRefresh = useNavigable({ id: "btn-refresh", onPress: onRefreshPress });
  const navGraph = useNavigable({ id: "btn-save-graph", onPress: onSaveGraphPress });

  const navDropdownTrigger = useNavigable({
    id: "btn-dropdown",
    onPress: () => handleDropdownChange(!isDropdownOpen),
  });

  const navDlAll = useNavigable({
    id: "drop-download-all",
    layerId: "header-dropdown",
    onPress: () => {
      onDownloadAllPress();
      handleDropdownChange(false);
    },
  });

  const navUpAll = useNavigable({
    id: "drop-upload-all",
    layerId: "header-dropdown",
    onPress: () => {
      onSyncAllPress();
      handleDropdownChange(false);
    },
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {/* Buscar juegos instalados */}
        <Button
          variant="flat"
          startContent={<Search size={18} />}
          onPress={onScanPress}
          className={`h-10 min-w-37.5 ${getGamepadFocusClass(navScan.isFocused, navScan.inputMode)}`}
          {...navScan.navProps}>
          Buscar juegos
        </Button>

        {/* CTA principal */}

        <Button
          variant="flat"
          startContent={<Network size={18} />}
          onPress={onSaveGraphPress}
          className={`h-10 min-w-37.5 ${getGamepadFocusClass(navGraph.isFocused, navGraph.inputMode)}`}
          {...navGraph.navProps}>
          Mapa general
        </Button>
        <Button
          color="primary"
          startContent={<Plus size={18} />}
          onPress={onAddPress}
          className={`h-10 min-w-37.5 font-semibold ${getGamepadFocusClass(navAdd.isFocused, navAdd.inputMode)}`}
          {...navAdd.navProps}>
          Añadir a tu biblioteca
        </Button>

        {/* Acciones rápidas */}
        {hasSyncConfig && (
          <Dropdown placement="bottom-end" isOpen={isDropdownOpen} onOpenChange={handleDropdownChange}>
            <DropdownTrigger>
              <Button
                variant="bordered"
                endContent={<ChevronDown size={16} />}
                isDisabled={!gamesCount || isOperationRunning}
                className={`h-10 min-w-40 ${getGamepadFocusClass(
                  navDropdownTrigger.isFocused,
                  navDropdownTrigger.inputMode
                )}`}
                {...navDropdownTrigger.navProps}>
                <Zap size={18} className="mr-1 text-yellow-400" />
                Sincronización
              </Button>
            </DropdownTrigger>

            <DropdownMenu aria-label="Acciones de sincronización">
              <DropdownItem
                key="download-all"
                startContent={
                  downloading === "all" ? <Spinner size="sm" color="current" /> : <CloudDownload size={16} />
                }
                isDisabled={!gamesCount || isOperationRunning}
                onPress={() => {
                  onDownloadAllPress();
                  handleDropdownChange(false);
                }}
                className={navDlAll.isFocused && navDlAll.inputMode === "gamepad" ? "bg-default-100 text-primary" : ""}
                {...navDlAll.navProps}>
                Descargar guardados (nube → PC)
              </DropdownItem>

              <DropdownItem
                key="upload-all"
                startContent={syncing === "all" ? <Spinner size="sm" color="current" /> : <CloudUpload size={16} />}
                isDisabled={!gamesCount || isOperationRunning}
                onPress={() => {
                  onSyncAllPress();
                  handleDropdownChange(false);
                }}
                className={navUpAll.isFocused && navUpAll.inputMode === "gamepad" ? "bg-default-100 text-primary" : ""}
                {...navUpAll.navProps}>
                Subir guardados (PC → nube)
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        )}

        {/* Refrescar */}
        <Button
          variant="light"
          startContent={!isRefreshing ? <RefreshCw size={18} /> : undefined}
          onPress={onRefreshPress}
          isLoading={isRefreshing}
          isDisabled={isRefreshing}
          className={`h-10 min-w-30 ${getGamepadFocusClass(navRefresh.isFocused, navRefresh.inputMode)}`}
          {...navRefresh.navProps}>
          Actualizar lista
        </Button>
      </div>
    </div>
  );
}
