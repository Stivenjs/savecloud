import { useState, useEffect, useCallback } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  backupConfigToCloud,
  createConfigFile,
  exportConfigToFile,
  getConfigPath,
  getS3TransferEndpointType,
  importConfigFromFile,
  importFriendConfig,
  restoreConfigFromCloud,
} from "@services/tauri";
import { MASKED_CONFIG_SECRET } from "@/constants/configMask";
import { useConfig } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "@utils/toast";
import i18n from "@lib/i18n";

export function useConfigManagement() {
  const { config, loading: loadingUseConfig } = useConfig();
  const { activeProfile } = useProfileSession();
  const queryClient = useQueryClient();

  const activeUserId = activeProfile?.localUserId?.trim() ?? "";
  const activeApiBaseUrl = activeProfile?.apiBaseUrl?.trim() || config?.apiBaseUrl?.trim() || "";

  // State
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [backingUpConfig, setBackingUpConfig] = useState(false);
  const [restoringConfig, setRestoringConfig] = useState(false);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);

  // Create/Edit Config modal
  const [createConfigModalOpen, setCreateConfigModalOpen] = useState(false);
  const [createApiBaseUrl, setCreateApiBaseUrl] = useState("");
  const [createWsBaseUrl, setCreateWsBaseUrl] = useState("");
  const [createApiKey, setCreateApiKey] = useState("");
  const [createUserId, setCreateUserId] = useState("");
  const [createSteamWebApiKey, setCreateSteamWebApiKey] = useState("");
  const [creatingConfig, setCreatingConfig] = useState(false);
  const [createConfigError, setCreateConfigError] = useState<string | null>(null);

  // Pull friend config modal
  const [pullFriendConfigModalOpen, setPullFriendConfigModalOpen] = useState(false);
  const [pullFriendUserId, setPullFriendUserId] = useState("");
  const [pullingFriendConfig, setPullingFriendConfig] = useState(false);

  const { data: configPath = "", isLoading: loadingConfigPath } = useQuery({
    queryKey: ["configPath"],
    queryFn: getConfigPath,
    staleTime: Infinity,
  });

  const { data: s3TransferEndpointType = null, isLoading: loadingS3 } = useQuery({
    queryKey: ["s3TransferEndpointType", activeApiBaseUrl, activeUserId],
    queryFn: async () => {
      try {
        return await getS3TransferEndpointType();
      } catch {
        return "unknown";
      }
    },
    enabled: !!activeApiBaseUrl && !!activeUserId,
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (createConfigModalOpen && config) {
      setCreateApiBaseUrl(config.apiBaseUrl ?? "");
      setCreateWsBaseUrl(config.wsBaseUrl ?? "");
      setCreateApiKey(config.apiKey ?? "");
      setCreateUserId(activeUserId || config.userId || "");
      setCreateSteamWebApiKey(config.steamWebApiKey ?? "");
    }
  }, [createConfigModalOpen, activeUserId, config]);

  const handleExportConfig = async () => {
    setExporting(true);
    try {
      const path = await save({
        title: "Exportar configuración",
        defaultPath: "SaveCloud-config.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) {
        await exportConfigToFile(path);
        toastSuccess(i18n.t("settings.toast.exportSuccess"), path);
      }
    } catch (e) {
      toastError(i18n.t("settings.toast.exportError"), e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  };

  const handleImportConfig = async (mode: "merge" | "replace") => {
    setImporting(true);
    try {
      const path = await open({
        title: "Importar configuración",
        directory: false,
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path && typeof path === "string") {
        await importConfigFromFile(path, mode);
        toastSuccess(
          i18n.t("settings.toast.importSuccess"),
          mode === "merge" ? i18n.t("settings.toast.gamesMerged") : i18n.t("settings.toast.configReplaced")
        );
        window.location.reload();
      }
    } catch (e) {
      toastError(i18n.t("settings.toast.importError"), e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const handleBackupConfigToCloud = async () => {
    setBackingUpConfig(true);
    try {
      await backupConfigToCloud();
      toastSuccess(i18n.t("settings.toast.backupSuccess"), i18n.t("settings.toast.backupSuccessDesc"));
    } catch (e) {
      toastError(i18n.t("settings.toast.backupError"), e instanceof Error ? e.message : String(e));
    } finally {
      setBackingUpConfig(false);
    }
  };

  const performRestoreConfigFromCloud = async () => {
    setRestoringConfig(true);
    try {
      await restoreConfigFromCloud();
      toastSuccess(i18n.t("settings.toast.restoreSuccess"), i18n.t("settings.toast.restoreSuccessDesc"));
      window.location.reload();
    } catch (e) {
      toastError(i18n.t("settings.toast.restoreError"), e instanceof Error ? e.message : String(e));
    } finally {
      setRestoringConfig(false);
    }
  };

  const handlePullFriendConfig = async () => {
    if (!pullFriendUserId.trim()) {
      toastError(i18n.t("settings.toast.error"), i18n.t("settings.toast.invalidUsername"));
      return;
    }
    setPullingFriendConfig(true);
    try {
      await importFriendConfig(pullFriendUserId);
      toastSuccess(
        i18n.t("settings.toast.importSuccess"),
        `Se ha importado la configuración de ${pullFriendUserId} correctamente.`
      );
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      toastError(i18n.t("settings.toast.importError"), e instanceof Error ? e.message : String(e));
    } finally {
      setPullingFriendConfig(false);
    }
  };

  const handleCreateConfigFile = async (restoreAfter: boolean = false) => {
    setCreatingConfig(true);
    setCreateConfigError(null);
    try {
      const apiKeyToSave =
        createApiKey === MASKED_CONFIG_SECRET || createApiKey === "********"
          ? config?.apiKey === MASKED_CONFIG_SECRET || config?.apiKey === "********"
            ? ""
            : (config?.apiKey ?? "")
          : createApiKey;
      const steamUnchanged = createSteamWebApiKey === MASKED_CONFIG_SECRET || createSteamWebApiKey === "********";
      const steamWebApiKeyArg = steamUnchanged ? null : createSteamWebApiKey.trim() || null;
      const path = await createConfigFile(
        createApiBaseUrl,
        createWsBaseUrl,
        apiKeyToSave ?? "",
        createUserId,
        steamWebApiKeyArg
      );
      setCreateConfigModalOpen(false);

      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["configPath"] });

      if (restoreAfter) {
        toastSuccess(i18n.t("settings.toast.connectionConfigured"), i18n.t("settings.toast.recoveringFromCloud"));
        await performRestoreConfigFromCloud();
      } else {
        toastSuccess(i18n.t("settings.toast.connectionSaved"), path);
      }
    } catch (e) {
      setCreateConfigError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingConfig(false);
    }
  };

  const openCreateConfigModal = useCallback(() => {
    setCreateConfigError(null);
    setCreateConfigModalOpen(true);
  }, []);

  return {
    config,
    configPath,
    loadingConfigData: loadingConfigPath || loadingS3 || loadingUseConfig,
    s3TransferEndpointType,
    exporting,
    importing,
    backingUpConfig,
    restoringConfig,
    restoreConfirmOpen,
    setRestoreConfirmOpen,
    createConfigModalOpen,
    setCreateConfigModalOpen,
    createApiBaseUrl,
    setCreateApiBaseUrl,
    createWsBaseUrl,
    setCreateWsBaseUrl,
    createApiKey,
    setCreateApiKey,
    createUserId,
    setCreateUserId,
    createSteamWebApiKey,
    setCreateSteamWebApiKey,
    creatingConfig,
    createConfigError,
    pullFriendConfigModalOpen,
    setPullFriendConfigModalOpen,
    pullFriendUserId,
    setPullFriendUserId,
    pullingFriendConfig,
    handleExportConfig,
    handleImportConfig,
    handleBackupConfigToCloud,
    performRestoreConfigFromCloud,
    handlePullFriendConfig,
    handleCreateConfigFile,
    openCreateConfigModal,
  };
}
