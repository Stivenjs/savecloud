import { useCallback, useEffect, useReducer, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import {
  backupConfigToCloud,
  createConfigFile,
  exportConfigToFile,
  getConfigPath,
  getS3TransferEndpointType,
  importConfigFromFile,
  restoreConfigFromCloud,
  scheduleConfigBackupToCloud,
  checkForUpdatesWithPrompt,
  setFullBackupStreaming,
  setFullBackupStreamingDryRun,
  setFullBackupPackagedCompressionLevel,
  importFriendConfig,
  syncSteamCatalog,
  resetSteamCatalogSync,
  exportSteamSeedManifestToCloud,
  resetCloudSeedState,
  importCloudSeedRunUntilDone,
  type SteamCatalogSyncProgressPayload,
  type SteamSeedImportProgressPayload,
  setDefaultSourceDownloadDir,
  setDeveloperMode,
  setProxyUrl,
  getDefaultSourceDownloadDir,
  setAutoExtractDownloads,
} from "@services/tauri";
import {
  getVerifiedSourcesStatus,
  importSourceFromFile,
  importSourceFromUrl,
  importSourcesFromFilesBatch,
  installVerifiedSources,
  listRemoteSources,
  listSourcesSummary,
  removeRemoteSource,
  removeSource,
  setRemoteSourceEnabled,
  syncRemoteSources,
  upsertRemoteSource,
} from "@services/tauri/sources.service";
import { getAlwaysShowSelectorCmd, setAlwaysShowSelectorCmd } from "@services/tauri/profile.service";
import { MASKED_CONFIG_SECRET } from "@/constants/configMask";
import { useConfig } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { useProfileSessionStore } from "@store/ProfileSessionStore";
import { STEAM_SEED_FRESHNESS_QUERY_KEY } from "@features/steam-catalog/hooks/useSteamSeedFreshness";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "@utils/toast";
import { notifyTest } from "@utils/notification";
import i18n from "@lib/i18n";

type SettingsPageState = {
  testingNotification: boolean;
  exporting: boolean;
  importing: boolean;
  checkingUpdate: boolean;
  createConfigModalOpen: boolean;
  pullFriendConfigModalOpen: boolean;
  pullFriendUserId: string;
  pullingFriendConfig: boolean;
  createApiBaseUrl: string;
  createWsBaseUrl: string;
  createApiKey: string;
  createUserId: string;
  createSteamWebApiKey: string;
  creatingConfig: boolean;
  createConfigError: string | null;
  backingUpConfig: boolean;
  restoringConfig: boolean;
  restoreConfirmOpen: boolean;
  resetSteamCatalogConfirmOpen: boolean;
  steamCatalogBusy: boolean;
  steamSeedBusy: boolean;
  sourcesBusy: boolean;
  sourceUrl: string;
  remoteSourceUrl: string;
  defaultSourceDownloadDir: string;
  proxyUrl: string;
};

type SettingsPageAction =
  | { type: "SET_TESTING_NOTIFICATION"; payload: boolean }
  | { type: "SET_EXPORTING"; payload: boolean }
  | { type: "SET_IMPORTING"; payload: boolean }
  | { type: "SET_CHECKING_UPDATE"; payload: boolean }
  | {
      type: "SET_CREATE_MODAL";
      open: boolean;
      apiBaseUrl?: string;
      wsBaseUrl?: string;
      apiKey?: string;
      userId?: string;
      steamWebApiKey?: string;
    }
  | { type: "SET_PULL_FRIEND_MODAL"; open: boolean }
  | { type: "SET_PULL_FRIEND_USER_ID"; payload: string }
  | { type: "SET_PULLING_FRIEND_CONFIG"; payload: boolean }
  | {
      type: "SET_CREATE_FORM_FROM_CONFIG";
      apiBaseUrl: string;
      wsBaseUrl: string;
      apiKey: string;
      userId: string;
      steamWebApiKey: string;
    }
  | { type: "SET_CREATE_API_BASE_URL"; payload: string }
  | { type: "SET_CREATE_WS_BASE_URL"; payload: string }
  | { type: "SET_CREATE_API_KEY"; payload: string }
  | { type: "SET_CREATE_USER_ID"; payload: string }
  | { type: "SET_CREATE_STEAM_WEB_API_KEY"; payload: string }
  | { type: "SET_CREATING_CONFIG"; payload: boolean }
  | { type: "SET_CREATE_CONFIG_ERROR"; payload: string | null }
  | { type: "SET_BACKING_UP_CONFIG"; payload: boolean }
  | { type: "SET_RESTORING_CONFIG"; payload: boolean }
  | { type: "SET_RESTORE_CONFIRM_OPEN"; payload: boolean }
  | { type: "SET_RESET_STEAM_CATALOG_CONFIRM_OPEN"; payload: boolean }
  | { type: "SET_STEAM_CATALOG_BUSY"; payload: boolean }
  | { type: "SET_STEAM_SEED_BUSY"; payload: boolean }
  | { type: "SET_SOURCES_BUSY"; payload: boolean }
  | { type: "SET_SOURCE_URL"; payload: string }
  | { type: "SET_REMOTE_SOURCE_URL"; payload: string }
  | { type: "SET_DEFAULT_SOURCE_DOWNLOAD_DIR"; payload: string }
  | { type: "SET_PROXY_URL"; payload: string };

const initialState: SettingsPageState = {
  testingNotification: false,
  exporting: false,
  importing: false,
  checkingUpdate: false,
  createConfigModalOpen: false,
  pullFriendConfigModalOpen: false,
  pullFriendUserId: "",
  pullingFriendConfig: false,
  createApiBaseUrl: "",
  createWsBaseUrl: "",
  createApiKey: "",
  createUserId: "",
  createSteamWebApiKey: "",
  creatingConfig: false,
  createConfigError: null,
  backingUpConfig: false,
  restoringConfig: false,
  restoreConfirmOpen: false,
  resetSteamCatalogConfirmOpen: false,
  steamCatalogBusy: false,
  steamSeedBusy: false,
  sourcesBusy: false,
  sourceUrl: "",
  remoteSourceUrl: "",
  defaultSourceDownloadDir: "",
  proxyUrl: "",
};

function settingsPageReducer(state: SettingsPageState, action: SettingsPageAction): SettingsPageState {
  switch (action.type) {
    case "SET_TESTING_NOTIFICATION":
      return { ...state, testingNotification: action.payload };
    case "SET_EXPORTING":
      return { ...state, exporting: action.payload };
    case "SET_IMPORTING":
      return { ...state, importing: action.payload };
    case "SET_CHECKING_UPDATE":
      return { ...state, checkingUpdate: action.payload };
    case "SET_PULL_FRIEND_MODAL":
      return { ...state, pullFriendConfigModalOpen: action.open };
    case "SET_PULL_FRIEND_USER_ID":
      return { ...state, pullFriendUserId: action.payload };
    case "SET_PULLING_FRIEND_CONFIG":
      return { ...state, pullingFriendConfig: action.payload };
    case "SET_CREATE_MODAL":
      return {
        ...state,
        createConfigModalOpen: action.open,
        ...(action.apiBaseUrl !== undefined && {
          createApiBaseUrl: action.apiBaseUrl,
        }),
        ...(action.wsBaseUrl !== undefined && {
          createWsBaseUrl: action.wsBaseUrl,
        }),
        ...(action.apiKey !== undefined && { createApiKey: action.apiKey }),
        ...(action.userId !== undefined && { createUserId: action.userId }),
        ...(action.steamWebApiKey !== undefined && { createSteamWebApiKey: action.steamWebApiKey }),
        ...(action.open && { createConfigError: null }),
      };
    case "SET_CREATE_FORM_FROM_CONFIG":
      return {
        ...state,
        createApiBaseUrl: action.apiBaseUrl,
        createWsBaseUrl: action.wsBaseUrl,
        createApiKey: action.apiKey,
        createUserId: action.userId,
        createSteamWebApiKey: action.steamWebApiKey,
      };
    case "SET_CREATE_API_BASE_URL":
      return { ...state, createApiBaseUrl: action.payload };
    case "SET_CREATE_WS_BASE_URL":
      return { ...state, createWsBaseUrl: action.payload };
    case "SET_CREATE_API_KEY":
      return { ...state, createApiKey: action.payload };
    case "SET_CREATE_USER_ID":
      return { ...state, createUserId: action.payload };
    case "SET_CREATE_STEAM_WEB_API_KEY":
      return { ...state, createSteamWebApiKey: action.payload };
    case "SET_CREATING_CONFIG":
      return { ...state, creatingConfig: action.payload };
    case "SET_CREATE_CONFIG_ERROR":
      return { ...state, createConfigError: action.payload };
    case "SET_BACKING_UP_CONFIG":
      return { ...state, backingUpConfig: action.payload };
    case "SET_RESTORING_CONFIG":
      return { ...state, restoringConfig: action.payload };
    case "SET_RESTORE_CONFIRM_OPEN":
      return { ...state, restoreConfirmOpen: action.payload };
    case "SET_RESET_STEAM_CATALOG_CONFIRM_OPEN":
      return { ...state, resetSteamCatalogConfirmOpen: action.payload };
    case "SET_STEAM_CATALOG_BUSY":
      return { ...state, steamCatalogBusy: action.payload };
    case "SET_STEAM_SEED_BUSY":
      return { ...state, steamSeedBusy: action.payload };
    case "SET_SOURCES_BUSY":
      return { ...state, sourcesBusy: action.payload };
    case "SET_SOURCE_URL":
      return { ...state, sourceUrl: action.payload };
    case "SET_REMOTE_SOURCE_URL":
      return { ...state, remoteSourceUrl: action.payload };
    case "SET_DEFAULT_SOURCE_DOWNLOAD_DIR":
      return { ...state, defaultSourceDownloadDir: action.payload };
    case "SET_PROXY_URL":
      return { ...state, proxyUrl: action.payload };
    default:
      return state;
  }
}

export function useSettingsPage() {
  const [state, dispatch] = useReducer(settingsPageReducer, initialState);
  const [steamCatalogSyncProgress, setSteamCatalogSyncProgress] = useState<SteamCatalogSyncProgressPayload | null>(
    null
  );
  const [steamSeedImportProgress, setSteamSeedImportProgress] = useState<SteamSeedImportProgressPayload | null>(null);
  const [deletingSourceIds, setDeletingSourceIds] = useState<Set<string>>(new Set());
  const [deletingRemoteSourceIds, setDeletingRemoteSourceIds] = useState<Set<string>>(new Set());
  const { config, loading: loadingUseConfig } = useConfig();
  const { activeProfile } = useProfileSession();
  const queryClient = useQueryClient();

  const activeUserId = activeProfile?.localUserId?.trim() ?? "";
  const activeApiBaseUrl = activeProfile?.apiBaseUrl?.trim() || config?.apiBaseUrl?.trim() || "";

  const { data: autostart = false, isLoading: loadingAutostart } = useQuery({
    queryKey: ["autostartStatus"],
    queryFn: isEnabled,
    staleTime: 1000 * 60 * 5,
  });

  const { data: alwaysShowProfileSelector = false, isLoading: loadingAlwaysShowProfileSelector } = useQuery({
    queryKey: ["alwaysShowProfileSelector"],
    queryFn: getAlwaysShowSelectorCmd,
    staleTime: 1000 * 60 * 5,
  });

  const { data: configPath = "", isLoading: loadingConfigPath } = useQuery({
    queryKey: ["configPath"],
    queryFn: getConfigPath,
    staleTime: Infinity,
  });

  const { data: sourcesSummary = [] } = useQuery({
    queryKey: ["sources-catalogs"],
    queryFn: listSourcesSummary,
  });

  const { data: remoteSources = [] } = useQuery({
    queryKey: ["remote-sources"],
    queryFn: listRemoteSources,
  });

  const { data: verifiedSourcesStatus = null } = useQuery({
    queryKey: ["verified-sources-status"],
    queryFn: getVerifiedSourcesStatus,
  });

  const { data: defaultSourceDownloadDirFromConfig = "" } = useQuery({
    queryKey: ["defaultSourceDownloadDir"],
    queryFn: async () => (await getDefaultSourceDownloadDir()) ?? "",
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  useEffect(() => {
    dispatch({
      type: "SET_DEFAULT_SOURCE_DOWNLOAD_DIR",
      payload: defaultSourceDownloadDirFromConfig,
    });
  }, [defaultSourceDownloadDirFromConfig]);

  useEffect(() => {
    if (config?.proxyUrl !== undefined) {
      dispatch({
        type: "SET_PROXY_URL",
        payload: config.proxyUrl ?? "",
      });
    }
  }, [config?.proxyUrl]);

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
    if (state.createConfigModalOpen && config) {
      dispatch({
        type: "SET_CREATE_FORM_FROM_CONFIG",
        apiBaseUrl: config.apiBaseUrl ?? "",
        wsBaseUrl: config.wsBaseUrl ?? "",
        apiKey: state.createApiKey || config.apiKey || "",
        userId: activeUserId || config.userId || "",
        steamWebApiKey: state.createSteamWebApiKey || config.steamWebApiKey || "",
      });
    }
  }, [
    state.createConfigModalOpen,
    activeUserId,
    config?.apiBaseUrl,
    config?.wsBaseUrl,
    config?.apiKey,
    config?.userId,
    config?.steamWebApiKey,
  ]);

  const handleExportConfig = async () => {
    dispatch({ type: "SET_EXPORTING", payload: true });
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
      dispatch({ type: "SET_EXPORTING", payload: false });
    }
  };

  const handleImportConfig = async (mode: "merge" | "replace") => {
    dispatch({ type: "SET_IMPORTING", payload: true });
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
      dispatch({ type: "SET_IMPORTING", payload: false });
    }
  };

  const handleCheckUpdates = async () => {
    dispatch({ type: "SET_CHECKING_UPDATE", payload: true });
    try {
      await checkForUpdatesWithPrompt();
    } finally {
      dispatch({ type: "SET_CHECKING_UPDATE", payload: false });
    }
  };

  const handleBackupConfigToCloud = async () => {
    dispatch({ type: "SET_BACKING_UP_CONFIG", payload: true });
    try {
      await backupConfigToCloud();
      toastSuccess(i18n.t("settings.toast.backupSuccess"), i18n.t("settings.toast.backupSuccessDesc"));
    } catch (e) {
      toastError(i18n.t("settings.toast.backupError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_BACKING_UP_CONFIG", payload: false });
    }
  };

  const performRestoreConfigFromCloud = async () => {
    dispatch({ type: "SET_RESTORING_CONFIG", payload: true });
    try {
      await restoreConfigFromCloud();
      toastSuccess(i18n.t("settings.toast.restoreSuccess"), i18n.t("settings.toast.restoreSuccessDesc"));
      window.location.reload();
    } catch (e) {
      toastError(i18n.t("settings.toast.restoreError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_RESTORING_CONFIG", payload: false });
    }
  };

  const handlePullFriendConfig = async () => {
    if (!state.pullFriendUserId.trim()) {
      toastError(i18n.t("settings.toast.error"), i18n.t("settings.toast.invalidUsername"));
      return;
    }
    dispatch({ type: "SET_PULLING_FRIEND_CONFIG", payload: true });
    try {
      await importFriendConfig(state.pullFriendUserId);
      toastSuccess(
        i18n.t("settings.toast.importSuccess"),
        `Se ha importado la configuración de ${state.pullFriendUserId} correctamente.`
      );
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      toastError(i18n.t("settings.toast.importError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_PULLING_FRIEND_CONFIG", payload: false });
    }
  };

  const handleTestNotification = async () => {
    dispatch({ type: "SET_TESTING_NOTIFICATION", payload: true });
    try {
      const ok = await notifyTest();
      if (!ok) {
        alert("Los permisos para notificaciones no están concedidos. Revisa la configuración del sistema.");
      }
    } finally {
      dispatch({ type: "SET_TESTING_NOTIFICATION", payload: false });
    }
  };

  const handleCreateConfigFile = async (restoreAfter: boolean = false) => {
    dispatch({ type: "SET_CREATING_CONFIG", payload: true });
    dispatch({ type: "SET_CREATE_CONFIG_ERROR", payload: null });
    try {
      const apiKeyToSave =
        state.createApiKey === MASKED_CONFIG_SECRET || state.createApiKey === "********"
          ? config?.apiKey === MASKED_CONFIG_SECRET || config?.apiKey === "********"
            ? ""
            : (config?.apiKey ?? "")
          : state.createApiKey;
      const steamUnchanged =
        state.createSteamWebApiKey === MASKED_CONFIG_SECRET || state.createSteamWebApiKey === "********";
      const steamWebApiKeyArg = steamUnchanged ? null : state.createSteamWebApiKey.trim() || null;
      const path = await createConfigFile(
        state.createApiBaseUrl,
        state.createWsBaseUrl,
        apiKeyToSave ?? "",
        state.createUserId,
        steamWebApiKeyArg
      );
      dispatch({ type: "SET_CREATE_MODAL", open: false });

      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["configPath"] });

      if (restoreAfter) {
        toastSuccess(i18n.t("settings.toast.connectionConfigured"), i18n.t("settings.toast.recoveringFromCloud"));
        await performRestoreConfigFromCloud();
      } else {
        toastSuccess(i18n.t("settings.toast.connectionSaved"), path);
      }
    } catch (e) {
      dispatch({
        type: "SET_CREATE_CONFIG_ERROR",
        payload: e instanceof Error ? e.message : String(e),
      });
    } finally {
      dispatch({ type: "SET_CREATING_CONFIG", payload: false });
    }
  };

  const handleAutostartChange = async (checked: boolean) => {
    try {
      if (checked) {
        await enable();
      } else {
        await disable();
      }
      queryClient.setQueryData(["autostartStatus"], checked);
    } catch (e) {
      console.error("Error al cambiar autostart:", e);
    }
  };

  const handleAlwaysShowProfileSelectorChange = async (checked: boolean) => {
    try {
      await setAlwaysShowSelectorCmd(checked);
      queryClient.setQueryData(["alwaysShowProfileSelector"], checked);
      toastSuccess(
        i18n.t("settings.toast.compressionSaved"), // preference saved / config saved
        checked
          ? i18n.t("settings.toast.alwaysShowProfileSelectorEnabled")
          : i18n.t("settings.toast.alwaysShowProfileSelectorDisabled")
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.savePreferenceError"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleFullBackupStreamingChange = async (enabled: boolean) => {
    try {
      await setFullBackupStreaming(enabled);
      scheduleConfigBackupToCloud();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(
        i18n.t("settings.toast.compressionSaved"),
        enabled
          ? i18n.t("settings.toast.fullBackupStreamingEnabled")
          : i18n.t("settings.toast.fullBackupStreamingDisabled")
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.saveError"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleFullBackupStreamingDryRunChange = async (enabled: boolean) => {
    try {
      await setFullBackupStreamingDryRun(enabled);
      scheduleConfigBackupToCloud();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(
        i18n.t("settings.toast.compressionSaved"),
        enabled ? i18n.t("settings.toast.dryRunEnabled") : i18n.t("settings.toast.dryRunDisabled")
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.saveError"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleFullBackupPackagedCompressionLevelChange = useCallback(
    async (level: number | null) => {
      try {
        await setFullBackupPackagedCompressionLevel(level);
        scheduleConfigBackupToCloud();
        queryClient.invalidateQueries({ queryKey: ["config"] });
        toastSuccess(i18n.t("settings.toast.compressionSaved"), i18n.t("settings.toast.compressionSavedDesc"));
      } catch (e) {
        toastError(i18n.t("settings.toast.saveError"), e instanceof Error ? e.message : String(e));
      }
    },
    [queryClient]
  );

  const handleDeveloperModeChange = async (enabled: boolean) => {
    const prev = useProfileSessionStore.getState().activeProfile?.developerMode ?? false;
    useProfileSessionStore.getState().patchSession({ developerMode: enabled });
    try {
      await setDeveloperMode(enabled);
      scheduleConfigBackupToCloud();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(
        i18n.t("settings.toast.compressionSaved"),
        enabled ? i18n.t("settings.toast.developerModeEnabled") : i18n.t("settings.toast.developerModeDisabled")
      );
    } catch (e) {
      useProfileSessionStore.getState().patchSession({ developerMode: prev });
      toastError(i18n.t("settings.toast.saveError"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleAutoExtractDownloadsChange = async (enabled: boolean) => {
    try {
      await setAutoExtractDownloads(enabled);
      scheduleConfigBackupToCloud();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(
        i18n.t("settings.toast.compressionSaved"),
        enabled ? i18n.t("settings.toast.autoExtractEnabled") : i18n.t("settings.toast.autoExtractDisabled")
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.saveError"), e instanceof Error ? e.message : String(e));
    }
  };

  const openCreateConfigModal = () => {
    dispatch({ type: "SET_CREATE_CONFIG_ERROR", payload: null });
    dispatch({ type: "SET_CREATE_MODAL", open: true });
  };

  const handleSyncSteamCatalog = async () => {
    if (state.steamCatalogBusy || state.steamSeedBusy) {
      toastError(i18n.t("settings.toast.syncInProgress"), i18n.t("settings.toast.waitProcesses"));
      return;
    }

    dispatch({ type: "SET_STEAM_CATALOG_BUSY", payload: true });
    setSteamCatalogSyncProgress(null);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<SteamCatalogSyncProgressPayload>("steam-catalog-sync-progress", (ev) => {
        setSteamCatalogSyncProgress(ev.payload);
      });
      const stats = await syncSteamCatalog();
      toastSuccess(
        i18n.t("settings.toast.steamListUpdated"),
        i18n.t("settings.toast.steamListUpdatedDesc", {
          count: stats.appsUpserted.toLocaleString(),
          batches: stats.batches,
          mode:
            stats.mode === "full"
              ? i18n.t("settings.toast.steamListUpdateDescFull")
              : i18n.t("settings.toast.steamListUpdateDescDelta"),
        })
      );
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalog"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalogFacets"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.steamListUpdateError"), e instanceof Error ? e.message : String(e));
    } finally {
      unlisten?.();
      setSteamCatalogSyncProgress(null);
      dispatch({ type: "SET_STEAM_CATALOG_BUSY", payload: false });
    }
  };

  const handleResetSteamCatalogSync = () => {
    dispatch({ type: "SET_RESET_STEAM_CATALOG_CONFIRM_OPEN", payload: true });
  };

  const confirmResetSteamCatalogSync = async () => {
    if (state.steamCatalogBusy || state.steamSeedBusy) {
      toastError(i18n.t("settings.toast.operationBlocked"), i18n.t("settings.toast.waitProcessesReset"));
      return;
    }

    dispatch({ type: "SET_STEAM_CATALOG_BUSY", payload: true });
    try {
      await resetSteamCatalogSync();
      toastSuccess(i18n.t("settings.toast.catalogResetSuccess"), i18n.t("settings.toast.catalogResetSuccessDesc"));
      dispatch({ type: "SET_RESET_STEAM_CATALOG_CONFIRM_OPEN", payload: false });
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalog"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalogFacets"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.catalogResetError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_STEAM_CATALOG_BUSY", payload: false });
    }
  };

  const handleExportSteamSeedManifest = async () => {
    if (state.steamCatalogBusy || state.steamSeedBusy) {
      toastError(i18n.t("settings.toast.operationBlocked"), i18n.t("settings.toast.waitProcessesExport"));
      return;
    }

    dispatch({ type: "SET_STEAM_SEED_BUSY", payload: true });
    try {
      const result = await exportSteamSeedManifestToCloud();
      toastSuccess(
        i18n.t("settings.toast.listSent"),
        i18n.t("settings.toast.listSentDesc", {
          count: result.appIdsExported.toLocaleString(),
          parts: result.partsUploaded,
        })
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.cannotSendList"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_STEAM_SEED_BUSY", payload: false });
    }
  };

  const handleResetCloudSeed = async () => {
    if (state.steamCatalogBusy || state.steamSeedBusy) {
      toastError(i18n.t("settings.toast.operationBlocked"), i18n.t("settings.toast.waitProcessesResetCloud"));
      return;
    }

    dispatch({ type: "SET_STEAM_SEED_BUSY", payload: true });
    try {
      await resetCloudSeedState();
      toastSuccess(i18n.t("settings.toast.cloudSeedResetSuccess"), i18n.t("settings.toast.cloudSeedResetSuccessDesc"));
      queryClient.invalidateQueries({ queryKey: STEAM_SEED_FRESHNESS_QUERY_KEY });
    } catch (e) {
      toastError(i18n.t("settings.toast.cannotRestart"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_STEAM_SEED_BUSY", payload: false });
    }
  };

  const handleImportCloudSeedFromCloud = async () => {
    if (state.steamCatalogBusy || state.steamSeedBusy) {
      toastError(i18n.t("settings.toast.syncInProgress"), i18n.t("settings.toast.waitProcessesDownload"));
      return;
    }

    dispatch({ type: "SET_STEAM_SEED_BUSY", payload: true });
    setSteamSeedImportProgress(null);
    let unlisten: (() => void) | undefined;
    try {
      unlisten = await listen<SteamSeedImportProgressPayload>("steam-seed-import-progress", (ev) => {
        setSteamSeedImportProgress(ev.payload);
      });
      const result = await importCloudSeedRunUntilDone();
      const trending =
        result.trendingPriorityEntries > 0
          ? i18n.t("settings.toast.downloadInfoSuccessDescTrending", { count: result.trendingPriorityEntries })
          : "";
      toastSuccess(
        i18n.t("settings.toast.downloadInfoSuccess"),
        i18n.t("settings.toast.downloadInfoSuccessDesc", {
          rows: result.rowsUpdated.toLocaleString(),
          batches: result.batchesProcessed,
          rounds: result.rounds,
          trending,
        })
      );
      queryClient.invalidateQueries({ queryKey: ["steamCatalog"] });
      queryClient.invalidateQueries({ queryKey: ["steamCatalogFacets"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
      queryClient.invalidateQueries({ queryKey: STEAM_SEED_FRESHNESS_QUERY_KEY });
    } catch (e) {
      toastError(i18n.t("settings.toast.cannotDownloadInfo"), e instanceof Error ? e.message : String(e));
    } finally {
      unlisten?.();
      setSteamSeedImportProgress(null);
      dispatch({ type: "SET_STEAM_SEED_BUSY", payload: false });
    }
  };

  const handleImportSourceByUrl = async (mode: "merge" | "replace") => {
    if (!state.sourceUrl.trim()) return;
    dispatch({ type: "SET_SOURCES_BUSY", payload: true });
    try {
      await i18n.t; // dummy to trigger i18n
      await importSourceFromUrl(state.sourceUrl.trim(), mode);
      toastSuccess(
        i18n.t("settings.toast.sourceImportUrlSuccess"),
        i18n.t("settings.toast.sourceImportUrlSuccessDesc")
      );
      dispatch({ type: "SET_SOURCE_URL", payload: "" });
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.importError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_SOURCES_BUSY", payload: false });
    }
  };

  const handleImportSourceByFile = async (mode: "merge" | "replace" | "updateorcreate") => {
    dispatch({ type: "SET_SOURCES_BUSY", payload: true });
    try {
      const path = await open({
        title: "Seleccionar JSON de fuente",
        directory: false,
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;
      await importSourceFromFile(path, mode);
      toastSuccess(
        i18n.t("settings.toast.sourceImportFileSuccess"),
        i18n.t("settings.toast.sourceImportFileSuccessDesc")
      );
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.importError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_SOURCES_BUSY", payload: false });
    }
  };

  const handleImportSourcesBatch = async (mode: "merge" | "replace" | "updateorcreate") => {
    dispatch({ type: "SET_SOURCES_BUSY", payload: true });
    try {
      const paths = await open({
        title: "Seleccionar múltiples JSONs de fuentes",
        directory: false,
        multiple: true,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!paths || !Array.isArray(paths) || paths.length === 0) return;

      const result = await importSourcesFromFilesBatch(paths, mode);

      if (result.failed === 0) {
        toastSuccess(
          i18n.t("settings.toast.sourcesImportedCountSuccess", { count: result.succeeded }),
          i18n.t("settings.toast.sourcesImportedCountSuccessDesc")
        );
      } else if (result.succeeded === 0) {
        toastError(
          i18n.t("settings.toast.importError"),
          i18n.t("settings.toast.noSourceImportedError", { error: result.items[0]?.error ?? "" })
        );
      } else {
        const updated = result.items.filter((i) => i.wasUpdated).length;
        const newOnes = result.succeeded - updated;
        toastSuccess(
          i18n.t("settings.toast.syncFinished", { count: result.succeeded }),
          `${newOnes} nuevas, ${updated} actualizadas. ${result.failed > 0 ? "Revisa los detalles." : ""}`
        );
      }

      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.importError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_SOURCES_BUSY", payload: false });
    }
  };

  const handleSelectDefaultSourceDownloadDir = async () => {
    const path = await open({
      title: "Seleccionar carpeta de descargas",
      directory: true,
      multiple: false,
    });
    if (!path || typeof path !== "string") return;
    dispatch({ type: "SET_DEFAULT_SOURCE_DOWNLOAD_DIR", payload: path });
    await setDefaultSourceDownloadDir(path);
    queryClient.setQueryData(["defaultSourceDownloadDir"], path);
    queryClient.invalidateQueries({ queryKey: ["config"] });
  };

  const handleSaveDefaultSourceDownloadDir = async () => {
    try {
      const next = state.defaultSourceDownloadDir.trim() || null;
      await setDefaultSourceDownloadDir(next);
      queryClient.setQueryData(["defaultSourceDownloadDir"], next ?? "");
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(i18n.t("settings.toast.pathSaved"), i18n.t("settings.toast.pathSavedDesc"));
    } catch (e) {
      toastError(i18n.t("settings.toast.pathSaveError"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleSaveProxyUrl = async () => {
    try {
      const next = state.proxyUrl.trim() || null;
      await setProxyUrl(next);
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(
        i18n.t("settings.toast.proxySaved"),
        next ? i18n.t("settings.toast.proxySavedUpdatedDesc") : i18n.t("settings.toast.proxySavedDisabledDesc")
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.proxySaveError"), e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    setDeletingSourceIds((prev) => new Set(prev).add(sourceId));
    try {
      await removeSource(sourceId);
      toastSuccess(i18n.t("settings.toast.sourceDeleted"), i18n.t("settings.toast.sourceDeletedDesc"));
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.sourceDeleteError"), e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  };

  const handleRegisterRemoteSource = async () => {
    const url = state.remoteSourceUrl.trim();
    if (!url) return;

    dispatch({ type: "SET_SOURCES_BUSY", payload: true });
    try {
      await upsertRemoteSource(url, true);
      dispatch({ type: "SET_REMOTE_SOURCE_URL", payload: "" });
      toastSuccess(i18n.t("settings.toast.sourceAdded"), i18n.t("settings.toast.sourceAddedDesc"));
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.sourceAddError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_SOURCES_BUSY", payload: false });
    }
  };

  const handleToggleRemoteSourceEnabled = async (sourceId: string, enabled: boolean) => {
    dispatch({ type: "SET_SOURCES_BUSY", payload: true });
    try {
      await setRemoteSourceEnabled(sourceId, enabled);
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
      toastSuccess(
        enabled ? i18n.t("settings.toast.sourceEnabled") : i18n.t("settings.toast.sourcePaused"),
        i18n.t("settings.toast.sourceStatusUpdatedDesc")
      );
    } catch (e) {
      toastError(i18n.t("settings.toast.sourceStatusUpdateError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_SOURCES_BUSY", payload: false });
    }
  };

  const handleDeleteRemoteSource = async (sourceId: string) => {
    setDeletingRemoteSourceIds((prev) => new Set(prev).add(sourceId));
    try {
      await removeRemoteSource(sourceId);
      toastSuccess(i18n.t("settings.toast.sourceRemoteDeleted"), i18n.t("settings.toast.sourceRemoteDeletedDesc"));
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.sourceRemoteDeleteError"), e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingRemoteSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  };

  const handleInstallVerifiedSources = async () => {
    dispatch({ type: "SET_SOURCES_BUSY", payload: true });
    try {
      const result = await installVerifiedSources(true);
      toastSuccess(
        i18n.t("settings.toast.verifiedSourcesInstalledSuccess"),
        i18n.t("settings.toast.verifiedSourcesInstalledSuccessDesc", {
          total: result.total,
          updated: result.updated,
          unchanged: result.unchanged,
        })
      );
      queryClient.invalidateQueries({ queryKey: ["verified-sources-status"] });
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.verifiedSourcesInstallError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_SOURCES_BUSY", payload: false });
    }
  };

  const handleSyncRemoteSources = async () => {
    dispatch({ type: "SET_SOURCES_BUSY", payload: true });
    try {
      const result = await syncRemoteSources();
      toastSuccess(
        i18n.t("settings.toast.syncFinished", { count: result.total }),
        i18n.t("settings.toast.syncFinishedDesc", {
          updated: result.updated,
          unchanged: result.unchanged,
          failed: result.failed,
        })
      );
      queryClient.invalidateQueries({ queryKey: ["remote-sources"] });
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
      queryClient.invalidateQueries({ queryKey: ["sources-matches"] });
      queryClient.invalidateQueries({ queryKey: ["sources-match-detail"] });
    } catch (e) {
      toastError(i18n.t("settings.toast.syncFinishedError"), e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_SOURCES_BUSY", payload: false });
    }
  };

  return {
    ...state,
    config,
    configPath,
    autostart,
    alwaysShowProfileSelector,
    loading: loadingAutostart,
    loadingAlwaysShowProfileSelector,
    loadingConfigData: loadingConfigPath || loadingS3 || loadingUseConfig,
    s3TransferEndpointType,
    handleExportConfig,
    handleImportConfig,
    handleCheckUpdates,
    handleBackupConfigToCloud,
    performRestoreConfigFromCloud,
    handleTestNotification,
    handleCreateConfigFile,
    handlePullFriendConfig,
    handleAutostartChange,
    handleAlwaysShowProfileSelectorChange,
    handleFullBackupStreamingChange,
    handleFullBackupStreamingDryRunChange,
    handleFullBackupPackagedCompressionLevelChange,
    handleDeveloperModeChange,
    handleSyncSteamCatalog,
    handleResetSteamCatalogSync,
    confirmResetSteamCatalogSync,
    handleExportSteamSeedManifest,
    handleResetCloudSeed,
    handleImportCloudSeedFromCloud,
    steamCatalogSyncProgress,
    steamSeedImportProgress,
    openCreateConfigModal,
    setCreateApiBaseUrl: (v: string) => dispatch({ type: "SET_CREATE_API_BASE_URL", payload: v }),
    setCreateWsBaseUrl: (v: string) => dispatch({ type: "SET_CREATE_WS_BASE_URL", payload: v }),
    setCreateApiKey: (v: string) => dispatch({ type: "SET_CREATE_API_KEY", payload: v }),
    setCreateUserId: (v: string) => dispatch({ type: "SET_CREATE_USER_ID", payload: v }),
    setCreateSteamWebApiKey: (v: string) => dispatch({ type: "SET_CREATE_STEAM_WEB_API_KEY", payload: v }),
    setCreateConfigModalOpen: (open: boolean) => dispatch({ type: "SET_CREATE_MODAL", open }),
    setRestoreConfirmOpen: (v: boolean) => dispatch({ type: "SET_RESTORE_CONFIRM_OPEN", payload: v }),
    setResetSteamCatalogConfirmOpen: (v: boolean) =>
      dispatch({ type: "SET_RESET_STEAM_CATALOG_CONFIRM_OPEN", payload: v }),
    setPullFriendConfigModalOpen: (open: boolean) => dispatch({ type: "SET_PULL_FRIEND_MODAL", open }),
    setPullFriendUserId: (id: string) => dispatch({ type: "SET_PULL_FRIEND_USER_ID", payload: id }),
    sourcesSummary,
    remoteSources,
    verifiedSourcesStatus,
    setSourceUrl: (v: string) => dispatch({ type: "SET_SOURCE_URL", payload: v }),
    setRemoteSourceUrl: (v: string) => dispatch({ type: "SET_REMOTE_SOURCE_URL", payload: v }),
    setDefaultSourceDownloadDir: (v: string) => dispatch({ type: "SET_DEFAULT_SOURCE_DOWNLOAD_DIR", payload: v }),
    setProxyUrl: (v: string) => dispatch({ type: "SET_PROXY_URL", payload: v }),
    handleImportSourceByUrl,
    handleImportSourceByFile,
    handleImportSourcesBatch,
    handleRegisterRemoteSource,
    handleToggleRemoteSourceEnabled,
    handleDeleteRemoteSource,
    handleInstallVerifiedSources,
    handleSyncRemoteSources,
    handleSelectDefaultSourceDownloadDir,
    handleSaveDefaultSourceDownloadDir,
    handleSaveProxyUrl,
    deletingSourceIds,
    deletingRemoteSourceIds,
    handleDeleteSource,
    handleAutoExtractDownloadsChange,
  };
}
