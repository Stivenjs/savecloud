import {
  Card,
  CardHeader,
  CardBody,
  CardFooter,
  Button,
  Switch,
  Chip,
  Input,
  Tooltip,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Checkbox,
} from "@heroui/react";
import {
  Blocks,
  FolderOpen,
  RefreshCw,
  Download,
  ScrollText,
  Search,
  Database,
  Trash2,
  AlertCircle,
  Clock,
  Sparkles,
  Code2,
} from "lucide-react";
import { type PluginInfo } from "@services/tauri";
import { useTranslation, Trans } from "react-i18next";
import { PluginLogsModal } from "@features/settings/Pluginlogsmodal";
import { PluginStorageModal } from "./PluginStorageModal";
import { usePluginsManager } from "./usePluginsManager";

export function PluginsSettingsSection() {
  const { t } = useTranslation();
  const {
    plugins,
    filteredPlugins,
    isLoading,
    isRefetching,
    searchQuery,
    setSearchQuery,
    activeCount,
    errorCount,
    logsModalOpen,
    setLogsModalOpen,
    selectedStoragePlugin,
    setSelectedStoragePlugin,
    pluginToDelete,
    setPluginToDelete,
    deleteClearStorage,
    setDeleteClearStorage,
    isExportingSdk,
    isReloadPending,
    isDeletePending,
    isTogglePending,
    handleToggle,
    handleReload,
    handleDelete,
    handleOpenPluginsFolder,
    handleOpenSingleFolder,
    handleOpenInVscode,
    handleExportSdk,
  } = usePluginsManager();

  return (
    <div className="space-y-4">
      {/* Tarjeta de Encabezado y Acciones Rápidas */}
      <Card className="p-3 bg-linear-to-br from-default-100/70 to-default-50/30 border border-default-200/60 dark:border-default-100/15">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Blocks size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-default-900">{t("settings.plugins.title")}</h2>
                <Chip size="sm" variant="flat" color="primary">
                  {t("settings.plugins.pluginsCount", { count: plugins.length })}
                </Chip>
              </div>
              <p className="text-xs text-default-500">{t("settings.plugins.subtitle")}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="flat" startContent={<FolderOpen size={15} />} onPress={handleOpenPluginsFolder}>
              {t("settings.plugins.openFolderBtn")}
            </Button>

            <Button
              size="sm"
              variant="flat"
              startContent={<RefreshCw size={15} className={isReloadPending || isRefetching ? "animate-spin" : ""} />}
              isLoading={isReloadPending || isRefetching}
              onPress={handleReload}>
              {t("settings.plugins.reloadBtn")}
            </Button>

            <Button
              size="sm"
              color="primary"
              variant="flat"
              startContent={<ScrollText size={15} />}
              onPress={() => setLogsModalOpen(true)}>
              {t("settings.plugins.viewLogsBtn")}
            </Button>
          </div>
        </CardHeader>

        <CardBody className="pt-2 pb-1">
          <div className="flex flex-wrap items-center gap-4 text-xs text-default-500 border-t border-default-200/40 dark:border-default-100/10 pt-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success inline-block" />
              <span>{t("settings.plugins.statsActive", { count: activeCount })}</span>
            </div>
            {errorCount > 0 ? (
              <div className="flex items-center gap-1.5 text-danger font-medium">
                <AlertCircle size={13} />
                <span>{t("settings.plugins.statsErrors", { count: errorCount })}</span>
              </div>
            ) : null}
            <div className="flex items-center gap-1.5 text-default-400">
              <Sparkles size={13} />
              <span>{t("settings.plugins.statsApiVersion", { version: 1 })}</span>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Buscador de Plugins */}
      {plugins.length > 0 ? (
        <div className="flex items-center justify-between gap-3">
          <Input
            size="sm"
            placeholder={t("settings.plugins.searchPlaceholder")}
            value={searchQuery}
            onValueChange={setSearchQuery}
            startContent={<Search size={15} className="text-default-400" />}
            isClearable
            onClear={() => setSearchQuery("")}
            className="max-w-xs"
          />
        </div>
      ) : null}

      {/* Lista de Tarjetas de Plugins */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-xs text-default-400">{t("common.loading")}</div>
      ) : filteredPlugins.length === 0 ? (
        <Card className="p-8 text-center border-dashed border-2 border-default-200/80 dark:border-default-100/20">
          <CardBody className="flex flex-col items-center justify-center gap-3">
            <div className="p-4 rounded-2xl bg-default-100/60 text-default-400">
              <Blocks size={36} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-default-800">
                {searchQuery ? t("settings.plugins.noSearchResults") : t("settings.plugins.emptyTitle")}
              </h3>
              <p className="text-xs text-default-500 max-w-md mt-1">
                {searchQuery ? t("settings.plugins.noSearchResultsDesc") : t("settings.plugins.emptyDesc")}
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                color="primary"
                startContent={<FolderOpen size={15} />}
                onPress={handleOpenPluginsFolder}>
                {t("settings.plugins.openFolderBtn")}
              </Button>
              <Button
                size="sm"
                variant="flat"
                startContent={<Download size={15} />}
                isLoading={isExportingSdk}
                onPress={handleExportSdk}>
                {t("settings.plugins.exportSdkBtn")}
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredPlugins.map((plugin: PluginInfo) => {
            const isToggleActive = isTogglePending(plugin.folderName);

            return (
              <Card
                key={plugin.folderName}
                className={`border transition-all duration-200 ${
                  plugin.error
                    ? "border-danger-300/60 bg-danger-50/10 dark:border-danger-900/40"
                    : plugin.enabled
                      ? "border-default-200/80 dark:border-default-100/20 hover:border-primary/40 shadow-xs"
                      : "border-default-200/40 dark:border-default-100/10 opacity-75"
                }`}>
                <CardHeader className="flex items-start justify-between gap-3 pb-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`p-2.5 rounded-xl mt-0.5 shrink-0 ${
                        plugin.error
                          ? "bg-danger-100/60 text-danger"
                          : plugin.enabled
                            ? "bg-primary/10 text-primary"
                            : "bg-default-100 text-default-400"
                      }`}>
                      <Blocks size={20} />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-default-900 truncate">{plugin.name}</h3>
                        <span className="text-[11px] font-mono text-default-400">v{plugin.version}</span>

                        {plugin.error ? (
                          <Chip size="sm" color="danger" variant="flat">
                            {t("settings.plugins.statusError")}
                          </Chip>
                        ) : plugin.enabled ? (
                          <Chip size="sm" color="success" variant="flat">
                            {t("settings.plugins.statusActive")}
                          </Chip>
                        ) : (
                          <Chip size="sm" color="default" variant="flat">
                            {t("settings.plugins.statusDisabled")}
                          </Chip>
                        )}
                      </div>

                      <p className="text-xs text-default-500 mt-1 line-clamp-2">
                        {plugin.description || t("settings.plugins.noDescription")}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-default-400">
                        <span className="font-mono bg-default-100/80 px-1.5 py-0.5 rounded text-[10px]">
                          ID: {plugin.id}
                        </span>
                        {plugin.author ? (
                          <span>{t("settings.plugins.byAuthor", { author: plugin.author })}</span>
                        ) : null}
                        <div className="flex items-center gap-1">
                          <Clock size={11} />
                          <span>{plugin.preUploadTimeoutMs}ms timeout</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Switch
                      size="sm"
                      isSelected={plugin.enabled}
                      isDisabled={Boolean(plugin.error) || isToggleActive}
                      onValueChange={(checked) => handleToggle(plugin.folderName, checked)}
                      aria-label={`Activar o desactivar plugin ${plugin.name}`}
                    />
                  </div>
                </CardHeader>

                {plugin.error ? (
                  <CardBody className="py-2 pt-0">
                    <div className="p-2.5 rounded-lg bg-danger-500/10 border border-danger-500/20 text-danger text-xs font-mono break-all">
                      <div className="flex items-center gap-1.5 font-semibold mb-1">
                        <AlertCircle size={14} />
                        <span>{t("settings.plugins.errorManifestTitle")}</span>
                      </div>
                      {plugin.error}
                    </div>
                  </CardBody>
                ) : null}

                <CardFooter className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-default-100/60 dark:border-default-100/10">
                  <div className="flex items-center gap-1.5 text-xs text-default-400">
                    <Database size={13} />
                    <span>{t("settings.plugins.storageKeysCount", { count: plugin.storageKeysCount })}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Tooltip content={t("settings.plugins.inspectStorageTooltip")}>
                      <Button
                        size="sm"
                        variant="light"
                        className="h-7 text-xs px-2"
                        startContent={<Database size={13} className="text-primary" />}
                        onPress={() => setSelectedStoragePlugin(plugin)}>
                        {t("settings.plugins.inspectStorageBtn")}
                      </Button>
                    </Tooltip>

                    <Tooltip content={t("settings.plugins.openPluginFolderTooltip")}>
                      <Button
                        size="sm"
                        variant="light"
                        isIconOnly
                        className="h-7 w-7"
                        onPress={() => handleOpenSingleFolder(plugin.folderName)}>
                        <FolderOpen size={14} />
                      </Button>
                    </Tooltip>

                    <Tooltip content={t("settings.plugins.openInVscodeTooltip")}>
                      <Button
                        size="sm"
                        variant="light"
                        isIconOnly
                        className="h-7 w-7 text-default-500 hover:text-primary"
                        onPress={() => handleOpenInVscode(plugin.folderName)}>
                        <Code2 size={14} />
                      </Button>
                    </Tooltip>

                    <Tooltip content={t("common.delete")}>
                      <Button
                        size="sm"
                        variant="light"
                        color="danger"
                        isIconOnly
                        className="h-7 w-7"
                        onPress={() => {
                          setPluginToDelete(plugin);
                          setDeleteClearStorage(false);
                        }}>
                        <Trash2 size={14} />
                      </Button>
                    </Tooltip>
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Tarjeta SDK para desarrolladores integrada */}
      <Card className="p-3 border border-default-200/60 dark:border-default-100/15">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-1">
          <div className="flex items-center gap-2">
            <Code2 size={18} className="text-primary" />
            <h3 className="text-sm font-semibold">{t("settings.sdk.title")}</h3>
          </div>

          <Button
            size="sm"
            color="primary"
            variant="flat"
            isLoading={isExportingSdk}
            startContent={!isExportingSdk && <Download size={14} />}
            onPress={handleExportSdk}>
            {t("settings.sdk.exportButton")}
          </Button>
        </CardHeader>

        <CardBody className="py-1 gap-2">
          <p className="text-xs text-default-500 leading-relaxed">
            <Trans
              i18nKey="settings.sdk.desc"
              components={{
                code: <code className="bg-default-100 px-1.5 py-0.5 rounded text-[11px] font-mono" />,
                strong: <strong />,
              }}
            />
          </p>

          <div className="rounded-lg bg-default-100/80 p-2.5 font-mono text-[11px] text-default-600">
            <div>---@class SaveCloudCore</div>
            <div>---@field storage SaveCloudStorage</div>
            <div>---@field notifications SaveCloudNotifications</div>
            <div>---@field games SaveCloudGames</div>
            <div>---@field log SaveCloudLog</div>
            <div>---@field ui SaveCloudUI</div>
            <div className="mt-1 text-primary-600">savecloud = {"{}"} ---@type SaveCloudCore</div>
          </div>
        </CardBody>
      </Card>

      {/* Modal de Logs de Plugins */}
      <PluginLogsModal isOpen={logsModalOpen} onClose={() => setLogsModalOpen(false)} />

      {/* Modal de Inspección SQLite */}
      <PluginStorageModal
        plugin={selectedStoragePlugin}
        isOpen={Boolean(selectedStoragePlugin)}
        onClose={() => setSelectedStoragePlugin(null)}
      />

      {/* Modal de Confirmación de Eliminación */}
      <Modal isOpen={Boolean(pluginToDelete)} onClose={() => setPluginToDelete(null)} size="md">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Trash2 size={18} className="text-danger" />
            <span>{t("settings.plugins.deleteModalTitle")}</span>
          </ModalHeader>
          <ModalBody className="gap-3">
            <p className="text-sm text-default-600">
              {t("settings.plugins.deleteModalPrompt", { name: pluginToDelete?.name })}
            </p>
            <div className="p-2.5 rounded-lg bg-default-100 text-xs font-mono text-default-500 truncate">
              {pluginToDelete?.folderPath}
            </div>
            <Checkbox size="sm" isSelected={deleteClearStorage} onValueChange={setDeleteClearStorage}>
              {t("settings.plugins.deleteClearStorageCheckbox")}
            </Checkbox>
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="flat" onPress={() => setPluginToDelete(null)}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" color="danger" isLoading={isDeletePending} onPress={handleDelete}>
              {t("common.delete")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
