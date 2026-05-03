import { useState, type ReactNode } from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner, Tooltip } from "@heroui/react";
import { ChevronDown, CloudDownload, CloudUpload, Network, Search, Plus, Zap, RefreshCw, ScanLine } from "lucide-react";
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
  density?: "comfortable" | "compact";
  /** Mapa general se muestra fuera del header (p. ej. icono mundo en rail BP). */
  omitMapGraph?: boolean;
  /** Contenido extra al final del grupo (ej. estadísticas BP). */
  trailingSlot?: ReactNode;
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
  density = "comfortable",
  omitMapGraph = false,
  trailingSlot,
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

  if (density === "compact") {
    return (
      <div className="flex flex-nowrap items-center gap-1.5">
        <Tooltip content="Buscar juegos en el equipo" placement="bottom" delay={400}>
          <Button
            isIconOnly
            size="sm"
            variant="flat"
            radius="md"
            aria-label="Buscar juegos en el equipo"
            onPress={onScanPress}
            className={`h-10 min-w-10 shrink-0 ${getGamepadFocusClass(navScan.isFocused, navScan.inputMode)}`}
            {...navScan.navProps}>
            <ScanLine size={19} aria-hidden />
          </Button>
        </Tooltip>

        {!omitMapGraph ? (
          <Tooltip content="Mapa general de guardados" placement="bottom" delay={400}>
            <Button
              isIconOnly
              size="sm"
              variant="flat"
              radius="md"
              aria-label="Mapa general de guardados"
              onPress={onSaveGraphPress}
              className={`h-10 min-w-10 shrink-0 ${getGamepadFocusClass(navGraph.isFocused, navGraph.inputMode)}`}
              {...navGraph.navProps}>
              <Network size={19} aria-hidden />
            </Button>
          </Tooltip>
        ) : null}

        <Tooltip content="Añadir a tu biblioteca" placement="bottom" delay={400}>
          <Button
            isIconOnly
            color="primary"
            size="sm"
            variant="solid"
            radius="md"
            aria-label="Añadir juego"
            onPress={onAddPress}
            className={`h-10 min-w-10 shrink-0 ${getGamepadFocusClass(navAdd.isFocused, navAdd.inputMode)}`}
            {...navAdd.navProps}>
            <Plus size={19} aria-hidden />
          </Button>
        </Tooltip>

        {hasSyncConfig ? (
          <Dropdown placement="bottom-end" isOpen={isDropdownOpen} onOpenChange={handleDropdownChange}>
            {/* Tooltip dentro de DropdownTrigger rompe la ref del ancla (floating-ui → "not of type Element"). */}
            <DropdownTrigger>
              <Button
                isIconOnly
                size="sm"
                variant="bordered"
                radius="md"
                aria-label="Sincronización con la nube"
                title="Sincronización con la nube"
                isDisabled={!gamesCount || isOperationRunning}
                className={`h-10 min-w-10 shrink-0 gap-0 border-default-400/65 ${getGamepadFocusClass(
                  navDropdownTrigger.isFocused,
                  navDropdownTrigger.inputMode
                )}`}
                {...navDropdownTrigger.navProps}>
                <Zap size={18} className="text-yellow-400" aria-hidden />
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
        ) : null}

        <Tooltip content={isRefreshing ? "Actualizando…" : "Actualizar lista"} placement="bottom" delay={400}>
          <Button
            isIconOnly
            variant="light"
            size="sm"
            radius="md"
            aria-label="Actualizar lista"
            onPress={onRefreshPress}
            isLoading={isRefreshing}
            isDisabled={isRefreshing}
            className={`h-10 min-w-10 shrink-0 ${getGamepadFocusClass(navRefresh.isFocused, navRefresh.inputMode)}`}
            {...navRefresh.navProps}>
            {!isRefreshing ? <RefreshCw size={18} aria-hidden /> : null}
          </Button>
        </Tooltip>

        {trailingSlot}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        {/* Buscar juegos instalados */}
        <Button
          variant="flat"
          startContent={<Search size={18} />}
          onPress={onScanPress}
          className={`h-10 min-w-[150px] ${getGamepadFocusClass(navScan.isFocused, navScan.inputMode)}`}
          {...navScan.navProps}>
          Buscar juegos
        </Button>

        {!omitMapGraph ? (
          <>
            <Button
              variant="flat"
              startContent={<Network size={18} />}
              onPress={onSaveGraphPress}
              className={`h-10 min-w-[150px] ${getGamepadFocusClass(navGraph.isFocused, navGraph.inputMode)}`}
              {...navGraph.navProps}>
              Mapa general
            </Button>
          </>
        ) : null}
        <Button
          color="primary"
          startContent={<Plus size={18} />}
          onPress={onAddPress}
          className={`h-10 min-w-[150px] font-semibold ${getGamepadFocusClass(navAdd.isFocused, navAdd.inputMode)}`}
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
                className={`h-10 min-w-[160px] ${getGamepadFocusClass(
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

        <Button
          variant="light"
          startContent={!isRefreshing ? <RefreshCw size={18} /> : undefined}
          onPress={onRefreshPress}
          isLoading={isRefreshing}
          isDisabled={isRefreshing}
          className={`h-10 min-w-[120px] ${getGamepadFocusClass(navRefresh.isFocused, navRefresh.inputMode)}`}
          {...navRefresh.navProps}>
          Actualizar lista
        </Button>

        {trailingSlot}
      </div>
    </div>
  );
}
