import { useState, type ReactNode } from "react";
import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner, Tooltip } from "@heroui/react";
import { useTranslation } from "react-i18next";
import {
  ChevronDown,
  CloudDownload,
  CloudUpload,
  Library as LibraryIcon,
  Network as NetworkIcon,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
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
  onTrashPress?: () => void;
  isRefreshing?: boolean;
  density?: "comfortable" | "compact" | "unified";
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
  onTrashPress,
  isRefreshing = false,
  density = "comfortable",
  omitMapGraph = false,
  trailingSlot,
}: GamesPageHeaderProps) {
  const { t } = useTranslation();
  const isOperationRunning = !!syncing || !!downloading;

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isUnifiedMenuOpen, setIsUnifiedMenuOpen] = useState(false);
  const { pushLayer, popLayer } = useNavigationStore();

  const handleDropdownChange = (isOpen: boolean) => {
    setIsDropdownOpen(isOpen);
    if (isOpen) {
      pushLayer("header-dropdown", "drop-download-all");
    } else {
      popLayer();
    }
  };

  const handleUnifiedMenuChange = (isOpen: boolean) => {
    setIsUnifiedMenuOpen(isOpen);
    if (isOpen) {
      pushLayer("header-unified-menu", "unified-scan");
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

  const navUnifiedTrigger = useNavigable({
    id: "btn-unified-actions",
    onPress: () => handleUnifiedMenuChange(!isUnifiedMenuOpen),
  });

  const navUnifiedScan = useNavigable({
    id: "unified-scan",
    layerId: "header-unified-menu",
    onPress: () => {
      onScanPress();
      handleUnifiedMenuChange(false);
    },
  });

  const navUnifiedGraph = useNavigable({
    id: "unified-graph",
    layerId: "header-unified-menu",
    onPress: () => {
      onSaveGraphPress();
      handleUnifiedMenuChange(false);
    },
  });

  const navUnifiedAdd = useNavigable({
    id: "unified-add",
    layerId: "header-unified-menu",
    onPress: () => {
      onAddPress();
      handleUnifiedMenuChange(false);
    },
  });

  const navUnifiedDlAll = useNavigable({
    id: "unified-dl-all",
    layerId: "header-unified-menu",
    onPress: () => {
      onDownloadAllPress();
      handleUnifiedMenuChange(false);
    },
  });

  const navUnifiedUpAll = useNavigable({
    id: "unified-up-all",
    layerId: "header-unified-menu",
    onPress: () => {
      onSyncAllPress();
      handleUnifiedMenuChange(false);
    },
  });

  const navUnifiedRefresh = useNavigable({
    id: "unified-refresh",
    layerId: "header-unified-menu",
    onPress: () => {
      if (!isRefreshing) onRefreshPress();
    },
  });

  if (density === "unified") {
    const syncDisabled = !gamesCount || isOperationRunning;

    return (
      <div className="flex min-w-0 flex-nowrap items-center gap-1.5">
        <Dropdown placement="bottom-end" isOpen={isUnifiedMenuOpen} onOpenChange={handleUnifiedMenuChange}>
          <DropdownTrigger>
            <Button
              variant="flat"
              radius="lg"
              aria-label={t("library.header.management")}
              aria-haspopup="menu"
              aria-expanded={isUnifiedMenuOpen}
              aria-busy={isRefreshing}
              className={`h-10 min-h-10 gap-2 border border-default-200/55 bg-default-100/40 px-4 font-semibold tracking-tight shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-sm dark:border-white/8 dark:bg-default-50/10 ${getGamepadFocusClass(
                navUnifiedTrigger.isFocused,
                navUnifiedTrigger.inputMode
              )}`}
              startContent={<LibraryIcon className="text-default-600" size={19} aria-hidden />}
              endContent={
                isRefreshing ? (
                  <Spinner size="sm" color="current" aria-label={t("library.header.updating")} />
                ) : (
                  <ChevronDown size={17} aria-hidden />
                )
              }
              {...navUnifiedTrigger.navProps}>
              <span className="hidden font-semibold text-foreground sm:inline">{t("library.header.management")}</span>
            </Button>
          </DropdownTrigger>

          <DropdownMenu
            aria-label={t("library.header.management")}
            variant="flat"
            classNames={{ base: "min-w-[16.5rem]" }}>
            <DropdownItem
              key="scan"
              startContent={<ScanLine size={16} />}
              onPress={() => {
                onScanPress();
                handleUnifiedMenuChange(false);
              }}
              className={
                navUnifiedScan.isFocused && navUnifiedScan.inputMode === "gamepad" ? "bg-default-100 text-primary" : ""
              }
              {...navUnifiedScan.navProps}>
              {t("library.header.scan")}
            </DropdownItem>

            {!omitMapGraph ? (
              <DropdownItem
                key="graph"
                startContent={<NetworkIcon size={16} />}
                onPress={() => {
                  onSaveGraphPress();
                  handleUnifiedMenuChange(false);
                }}
                className={
                  navUnifiedGraph.isFocused && navUnifiedGraph.inputMode === "gamepad"
                    ? "bg-default-100 text-primary"
                    : ""
                }
                {...navUnifiedGraph.navProps}>
                {t("library.header.map")}
              </DropdownItem>
            ) : null}

            <DropdownItem
              key="add"
              color="primary"
              className={navUnifiedAdd.isFocused && navUnifiedAdd.inputMode === "gamepad" ? "bg-default-100" : ""}
              startContent={<Plus size={16} />}
              onPress={() => {
                onAddPress();
                handleUnifiedMenuChange(false);
              }}
              {...navUnifiedAdd.navProps}
              showDivider>
              {t("library.header.add")}
            </DropdownItem>

            {hasSyncConfig ? (
              <>
                <DropdownItem
                  key="download-all"
                  startContent={
                    downloading === "all" ? <Spinner size="sm" color="current" /> : <CloudDownload size={16} />
                  }
                  isDisabled={syncDisabled}
                  description={t("library.header.downloadAllDesc")}
                  onPress={() => {
                    if (syncDisabled) return;
                    onDownloadAllPress();
                    handleUnifiedMenuChange(false);
                  }}
                  className={
                    navUnifiedDlAll.isFocused && navUnifiedDlAll.inputMode === "gamepad"
                      ? "bg-default-100 text-primary"
                      : ""
                  }
                  {...navUnifiedDlAll.navProps}>
                  {t("library.header.downloadAllLabel")}
                </DropdownItem>
                <DropdownItem
                  key="upload-all"
                  startContent={syncing === "all" ? <Spinner size="sm" color="current" /> : <CloudUpload size={16} />}
                  isDisabled={syncDisabled}
                  description={t("library.header.syncAllDesc")}
                  onPress={() => {
                    if (syncDisabled) return;
                    onSyncAllPress();
                    handleUnifiedMenuChange(false);
                  }}
                  className={
                    navUnifiedUpAll.isFocused && navUnifiedUpAll.inputMode === "gamepad"
                      ? "bg-default-100 text-primary"
                      : ""
                  }
                  {...navUnifiedUpAll.navProps}
                  showDivider>
                  {t("library.header.syncAllLabel")}
                </DropdownItem>
                {onTrashPress ? (
                  <DropdownItem
                    key="trash"
                    startContent={<Trash2 size={16} />}
                    onPress={() => {
                      onTrashPress();
                      handleUnifiedMenuChange(false);
                    }}>
                    {t("library.trashModal.title")}
                  </DropdownItem>
                ) : null}
              </>
            ) : null}

            <DropdownItem
              key="refresh"
              closeOnSelect={false}
              startContent={isRefreshing ? <Spinner size="sm" color="current" /> : <RefreshCw size={16} />}
              isDisabled={isRefreshing}
              onPress={() => {
                if (!isRefreshing) onRefreshPress();
              }}
              className={
                navUnifiedRefresh.isFocused && navUnifiedRefresh.inputMode === "gamepad"
                  ? "bg-default-100 text-primary"
                  : ""
              }
              {...navUnifiedRefresh.navProps}>
              {isRefreshing ? t("library.header.updating") : t("library.header.refresh")}
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>

        {trailingSlot}
      </div>
    );
  }

  if (density === "compact") {
    return (
      <div className="flex flex-nowrap items-center gap-1.5">
        <Tooltip content={t("library.header.scanTooltip")} placement="bottom" delay={400}>
          <Button
            isIconOnly
            size="sm"
            variant="flat"
            radius="md"
            aria-label={t("library.header.scanTooltip")}
            onPress={onScanPress}
            className={`h-10 min-w-10 shrink-0 ${getGamepadFocusClass(navScan.isFocused, navScan.inputMode)}`}
            {...navScan.navProps}>
            <ScanLine size={19} aria-hidden />
          </Button>
        </Tooltip>

        {!omitMapGraph ? (
          <Tooltip content={t("library.header.mapTooltip")} placement="bottom" delay={400}>
            <Button
              isIconOnly
              size="sm"
              variant="flat"
              radius="md"
              aria-label={t("library.header.mapTooltip")}
              onPress={onSaveGraphPress}
              className={`h-10 min-w-10 shrink-0 ${getGamepadFocusClass(navGraph.isFocused, navGraph.inputMode)}`}
              {...navGraph.navProps}>
              <NetworkIcon size={19} aria-hidden />
            </Button>
          </Tooltip>
        ) : null}

        <Tooltip content={t("library.header.add")} placement="bottom" delay={400}>
          <Button
            isIconOnly
            color="primary"
            size="sm"
            variant="solid"
            radius="md"
            aria-label={t("library.addGame")}
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
                aria-label={t("library.syncAll")}
                title={t("library.syncAll")}
                isDisabled={!gamesCount || isOperationRunning}
                className={`h-10 min-w-10 shrink-0 gap-0 border-default-400/65 ${getGamepadFocusClass(
                  navDropdownTrigger.isFocused,
                  navDropdownTrigger.inputMode
                )}`}
                {...navDropdownTrigger.navProps}>
                <Zap size={18} className="text-yellow-400" aria-hidden />
              </Button>
            </DropdownTrigger>
            <DropdownMenu aria-label={t("library.syncAll")}>
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
                {t("library.header.downloadAllLabel")}
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
                {t("library.header.syncAllLabel")}
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        ) : null}

        {hasSyncConfig && onTrashPress && (
          <Tooltip content={t("library.trashModal.title")} placement="bottom" delay={400}>
            <Button
              isIconOnly
              variant="flat"
              radius="md"
              size="sm"
              aria-label={t("library.trashModal.title")}
              onPress={onTrashPress}
              className="h-10 min-w-10 shrink-0 text-default-600 hover:text-warning">
              <Trash2 size={18} />
            </Button>
          </Tooltip>
        )}

        <Tooltip
          content={isRefreshing ? t("library.header.updating") : t("library.header.refresh")}
          placement="bottom"
          delay={400}>
          <Button
            isIconOnly
            variant="light"
            size="sm"
            radius="md"
            aria-label={t("library.header.refresh")}
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
          className={`h-10 min-w-37.5 ${getGamepadFocusClass(navScan.isFocused, navScan.inputMode)}`}
          {...navScan.navProps}>
          {t("library.header.scan")}
        </Button>

        {!omitMapGraph ? (
          <>
            <Button
              variant="flat"
              startContent={<NetworkIcon size={18} />}
              onPress={onSaveGraphPress}
              className={`h-10 min-w-37.5 ${getGamepadFocusClass(navGraph.isFocused, navGraph.inputMode)}`}
              {...navGraph.navProps}>
              {t("library.header.map")}
            </Button>
          </>
        ) : null}
        <Button
          color="primary"
          startContent={<Plus size={18} />}
          onPress={onAddPress}
          className={`h-10 min-w-37.5 font-semibold ${getGamepadFocusClass(navAdd.isFocused, navAdd.inputMode)}`}
          {...navAdd.navProps}>
          {t("library.header.add")}
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
                {t("library.syncAll")}
              </Button>
            </DropdownTrigger>

            <DropdownMenu aria-label={t("library.syncAll")}>
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
                {t("library.header.downloadAllLabel")}
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
                {t("library.header.syncAllLabel")}
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        )}

        {hasSyncConfig && onTrashPress && (
          <Tooltip content={t("library.trashModal.title")} placement="bottom" delay={400}>
            <Button
              variant="light"
              isIconOnly
              onPress={onTrashPress}
              aria-label={t("library.trashModal.title")}
              className="h-10 min-w-10 text-default-600 hover:text-warning">
              <Trash2 size={18} />
            </Button>
          </Tooltip>
        )}

        <Button
          variant="light"
          startContent={!isRefreshing ? <RefreshCw size={18} /> : undefined}
          onPress={onRefreshPress}
          isLoading={isRefreshing}
          isDisabled={isRefreshing}
          className={`h-10 min-w-30 ${getGamepadFocusClass(navRefresh.isFocused, navRefresh.inputMode)}`}
          {...navRefresh.navProps}>
          {t("library.header.refresh")}
        </Button>

        {trailingSlot}
      </div>
    </div>
  );
}
