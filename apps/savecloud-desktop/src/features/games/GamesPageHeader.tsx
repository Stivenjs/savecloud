import { useState } from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner } from "@heroui/react";
import { ChevronDown, CloudDownload, CloudUpload, Search, Plus, Zap, RefreshCw } from "lucide-react";
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
        {/* BOTÓN: Analizar Rutas */}
        <Button
          variant="bordered"
          startContent={<Search size={18} />}
          onPress={onScanPress}
          className={`h-10 min-w-[120px] ${getGamepadFocusClass(navScan.isFocused, navScan.inputMode)}`}
          {...navScan.navProps}>
          Analizar rutas
        </Button>

        {/* BOTÓN: Añadir Juego */}
        <Button
          color="primary"
          startContent={<Plus size={18} />}
          onPress={onAddPress}
          className={`h-10 min-w-[120px] ${getGamepadFocusClass(navAdd.isFocused, navAdd.inputMode)}`}
          {...navAdd.navProps}>
          Añadir juego
        </Button>

        {/* DROPDOWN COMPLETO: Acciones Rápidas */}
        {hasSyncConfig && (
          <Dropdown placement="bottom-end" isOpen={isDropdownOpen} onOpenChange={handleDropdownChange}>
            <DropdownTrigger>
              <Button
                variant="bordered"
                endContent={<ChevronDown size={16} />}
                isDisabled={!gamesCount || isOperationRunning}
                className={`h-10 min-w-[140px] ${getGamepadFocusClass(navDropdownTrigger.isFocused, navDropdownTrigger.inputMode)}`}
                {...navDropdownTrigger.navProps}>
                <Zap size={18} className="mr-1" />
                Acciones rápidas
              </Button>
            </DropdownTrigger>

            <DropdownMenu aria-label="Acciones rápidas">
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
                Descargar todos
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
                Subir todos
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        )}

        {/* BOTÓN: Actualizar */}
        <Button
          variant="bordered"
          startContent={!isRefreshing ? <RefreshCw size={18} /> : undefined}
          onPress={onRefreshPress}
          isLoading={isRefreshing}
          isDisabled={isRefreshing}
          className={`h-10 min-w-[120px] ${getGamepadFocusClass(navRefresh.isFocused, navRefresh.inputMode)}`}
          {...navRefresh.navProps}>
          Actualizar
        </Button>
      </div>
    </div>
  );
}
