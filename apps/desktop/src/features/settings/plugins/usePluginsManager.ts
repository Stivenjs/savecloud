import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import {
  getInstalledPlugins,
  togglePluginEnabled,
  reloadPlugins,
  openPluginsFolder,
  openPluginFolder,
  deletePlugin,
  exportPluginSdk,
  type PluginInfo,
} from "@services/tauri";
import { toastSuccess, toastError } from "@utils/toast";

export function usePluginsManager() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 250);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [selectedStoragePlugin, setSelectedStoragePlugin] = useState<PluginInfo | null>(null);
  const [pluginToDelete, setPluginToDelete] = useState<PluginInfo | null>(null);
  const [deleteClearStorage, setDeleteClearStorage] = useState(false);
  const [isExportingSdk, setIsExportingSdk] = useState(false);

  // Consulta de plugins instalados
  const {
    data: plugins = [],
    isLoading,
    isRefetching,
  } = useQuery<PluginInfo[]>({
    queryKey: ["installed-plugins"],
    queryFn: getInstalledPlugins,
  });

  // Mutación: Activar/Desactivar
  const toggleMutation = useMutation<PluginInfo, unknown, { folderName: string; enabled: boolean }>({
    mutationFn: ({ folderName, enabled }: { folderName: string; enabled: boolean }) =>
      togglePluginEnabled(folderName, enabled),
    onSuccess: (updated: PluginInfo) => {
      queryClient.setQueryData<PluginInfo[]>(["installed-plugins"], (old: PluginInfo[] | undefined) => {
        if (!old) return [updated];
        return old.map((p: PluginInfo) => (p.folderName === updated.folderName ? updated : p));
      });
      toastSuccess(
        updated.enabled
          ? t("settings.plugins.toastEnabled", { name: updated.name })
          : t("settings.plugins.toastDisabled", { name: updated.name })
      );
    },
    onError: (err: unknown) => {
      toastError(t("settings.plugins.toastToggleError"), String(err));
      queryClient.invalidateQueries({ queryKey: ["installed-plugins"] });
    },
  });

  // Mutación: Recargar
  const reloadMutation = useMutation<PluginInfo[], unknown, void>({
    mutationFn: reloadPlugins,
    onSuccess: (updatedList: PluginInfo[]) => {
      queryClient.setQueryData<PluginInfo[]>(["installed-plugins"], updatedList);
      toastSuccess(
        t("settings.plugins.toastReloadSuccess"),
        t("settings.plugins.toastReloadSuccessDesc", { count: updatedList.length })
      );
    },
    onError: (err: unknown) => {
      toastError(t("settings.plugins.toastReloadError"), String(err));
    },
  });

  // Mutación: Eliminar
  const deleteMutation = useMutation<void, unknown, { folderName: string; clearStorage: boolean }>({
    mutationFn: ({ folderName, clearStorage }: { folderName: string; clearStorage: boolean }) =>
      deletePlugin(folderName, clearStorage),
    onSuccess: () => {
      toastSuccess(
        t("settings.plugins.toastDeleteSuccess"),
        t("settings.plugins.toastDeleteSuccessDesc", { name: pluginToDelete?.name })
      );
      setPluginToDelete(null);
      setDeleteClearStorage(false);
      queryClient.invalidateQueries({ queryKey: ["installed-plugins"] });
    },
    onError: (err: unknown) => {
      toastError(t("settings.plugins.toastDeleteError"), String(err));
    },
  });

  const handleOpenPluginsFolder = async (): Promise<void> => {
    try {
      await openPluginsFolder();
    } catch (e: unknown) {
      toastError(t("settings.plugins.toastFolderError"), String(e));
    }
  };

  const handleOpenSingleFolder = async (folderName: string): Promise<void> => {
    try {
      await openPluginFolder(folderName);
    } catch (e: unknown) {
      toastError(t("settings.plugins.toastFolderError"), String(e));
    }
  };

  const handleExportSdk = async (): Promise<void> => {
    setIsExportingSdk(true);
    try {
      const path = await exportPluginSdk();
      if (path) {
        toastSuccess(t("settings.sdk.toastExportSuccess"), t("settings.sdk.toastExportSuccessDesc", { path }));
      }
    } catch (error: unknown) {
      if (error !== "CANCELADO") {
        toastError(t("settings.sdk.toastExportError"), t("settings.sdk.toastExportErrorDesc"));
      }
    } finally {
      setIsExportingSdk(false);
    }
  };

  const handleToggle = (folderName: string, enabled: boolean) => {
    toggleMutation.mutate({ folderName, enabled });
  };

  const handleReload = () => {
    reloadMutation.mutate();
  };

  const handleDelete = () => {
    if (pluginToDelete) {
      deleteMutation.mutate({
        folderName: pluginToDelete.folderName,
        clearStorage: deleteClearStorage,
      });
    }
  };

  const filteredPlugins: PluginInfo[] = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return plugins;
    const q = debouncedSearchQuery.toLowerCase();
    return plugins.filter(
      (p: PluginInfo) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.author && p.author.toLowerCase().includes(q))
    );
  }, [plugins, debouncedSearchQuery]);

  const activeCount = plugins.filter((p: PluginInfo) => p.enabled && p.loaded).length;
  const errorCount = plugins.filter((p: PluginInfo) => Boolean(p.error)).length;

  return {
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
    isReloadPending: reloadMutation.isPending,
    isDeletePending: deleteMutation.isPending,
    isTogglePending: (folderName: string) =>
      toggleMutation.isPending && toggleMutation.variables?.folderName === folderName,
    handleToggle,
    handleReload,
    handleDelete,
    handleOpenPluginsFolder,
    handleOpenSingleFolder,
    handleExportSdk,
  };
}
