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
  getDefaultSourceDownloadDir,
  setDefaultSourceDownloadDir,
} from "@services/tauri";
import {
  importSourceFromFile,
  importSourceFromUrl,
  importSourcesFromFilesBatch,
  listSourcesSummary,
  removeSource,
} from "@services/tauri/sources.service";
import { getAlwaysShowSelectorCmd, setAlwaysShowSelectorCmd } from "@services/tauri/profile.service";
import { MASKED_CONFIG_SECRET } from "@/constants/configMask";
import { useConfig } from "@hooks/useConfig";
import { useProfileSession } from "@hooks/useProfileSession";
import { STEAM_SEED_FRESHNESS_QUERY_KEY } from "@features/steam-catalog/hooks/useSteamSeedFreshness";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "@utils/toast";
import { notifyTest } from "@utils/notification";

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
  defaultSourceDownloadDir: string;
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
  | { type: "SET_DEFAULT_SOURCE_DOWNLOAD_DIR"; payload: string };

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
  defaultSourceDownloadDir: "",
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
    case "SET_DEFAULT_SOURCE_DOWNLOAD_DIR":
      return { ...state, defaultSourceDownloadDir: action.payload };
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
  const { config, loading: loadingUseConfig, refetch: refetchConfig } = useConfig();
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
        toastSuccess("Configuración exportada", path);
      }
    } catch (e) {
      toastError("Error al exportar", e instanceof Error ? e.message : String(e));
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
        toastSuccess("Configuración importada", mode === "merge" ? "Juegos fusionados" : "Configuración reemplazada");
        window.location.reload();
      }
    } catch (e) {
      toastError("Error al importar", e instanceof Error ? e.message : String(e));
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
      toastSuccess("Configuración respaldada", "Se subió config.json a la nube para este usuario.");
    } catch (e) {
      toastError("Error al respaldar", e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_BACKING_UP_CONFIG", payload: false });
    }
  };

  const performRestoreConfigFromCloud = async () => {
    dispatch({ type: "SET_RESTORING_CONFIG", payload: true });
    try {
      await restoreConfigFromCloud();
      toastSuccess("Configuración restaurada", "Se aplicó la configuración desde la nube.");
      window.location.reload();
    } catch (e) {
      toastError("Error al restaurar", e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_RESTORING_CONFIG", payload: false });
    }
  };

  const handlePullFriendConfig = async () => {
    if (!state.pullFriendUserId.trim()) {
      toastError("Error", "Ingresa un usuario válido.");
      return;
    }
    dispatch({ type: "SET_PULLING_FRIEND_CONFIG", payload: true });
    try {
      await importFriendConfig(state.pullFriendUserId);
      toastSuccess(
        "Configuración importada",
        `Se ha importado la configuración de ${state.pullFriendUserId} correctamente.`
      );
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      toastError("Error al importar", e instanceof Error ? e.message : String(e));
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

      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      queryClient.invalidateQueries({ queryKey: ["configPath"] });

      if (restoreAfter) {
        toastSuccess("Conexión configurada", "Iniciando recuperación desde la nube...");
        await performRestoreConfigFromCloud();
      } else {
        toastSuccess("Conexión guardada", path);
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
        "Preferencia guardada",
        checked
          ? "Se mostrará el panel de perfiles en cada inicio."
          : "La app abrirá directamente el último perfil usado."
      );
    } catch (e) {
      toastError("Error al guardar preferencia", e instanceof Error ? e.message : String(e));
    }
  };

  const handleFullBackupStreamingChange = async (enabled: boolean) => {
    try {
      await setFullBackupStreaming(enabled);
      scheduleConfigBackupToCloud();
      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(
        "Configuración guardada",
        enabled ? "Backup completo en streaming activado." : "Backup completo en streaming desactivado."
      );
    } catch (e) {
      toastError("Error al guardar", e instanceof Error ? e.message : String(e));
    }
  };

  const handleFullBackupStreamingDryRunChange = async (enabled: boolean) => {
    try {
      await setFullBackupStreamingDryRun(enabled);
      scheduleConfigBackupToCloud();
      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      toastSuccess(
        "Configuración guardada",
        enabled
          ? "Modo prueba de backup streaming activado (no sube a la nube)."
          : "Modo prueba de backup streaming desactivado."
      );
    } catch (e) {
      toastError("Error al guardar", e instanceof Error ? e.message : String(e));
    }
  };

  const handleFullBackupPackagedCompressionLevelChange = useCallback(
    async (level: number | null) => {
      try {
        await setFullBackupPackagedCompressionLevel(level);
        scheduleConfigBackupToCloud();
        refetchConfig?.();
        queryClient.invalidateQueries({ queryKey: ["config"] });
        toastSuccess("Configuración guardada", "Nivel de compresión de backups empaquetados actualizado.");
      } catch (e) {
        toastError("Error al guardar", e instanceof Error ? e.message : String(e));
      }
    },
    [queryClient, refetchConfig]
  );

  const openCreateConfigModal = () => {
    dispatch({ type: "SET_CREATE_CONFIG_ERROR", payload: null });
    dispatch({ type: "SET_CREATE_MODAL", open: true });
  };

  const handleSyncSteamCatalog = async () => {
    if (state.steamCatalogBusy || state.steamSeedBusy) {
      toastError("Sincronización en curso", "Por favor, espera a que terminen los procesos actuales.");
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
        "Listado de juegos actualizado",
        `Se guardaron ${stats.appsUpserted.toLocaleString()} entradas en ${stats.batches} pasos (${stats.mode === "full" ? "descarga completa" : "solo novedades"}).`
      );
      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: ["config"] });
    } catch (e) {
      toastError("No se pudo actualizar el listado de Steam", e instanceof Error ? e.message : String(e));
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
      toastError("Operación bloqueada", "Por favor, espera a que terminen los procesos actuales antes de reiniciar.");
      return;
    }

    dispatch({ type: "SET_STEAM_CATALOG_BUSY", payload: true });
    try {
      await resetSteamCatalogSync();
      toastSuccess("Listado restablecido", "La próxima vez se descargará el catálogo completo de nuevo.");
      dispatch({ type: "SET_RESET_STEAM_CATALOG_CONFIRM_OPEN", payload: false });
    } catch (e) {
      toastError("Error al restablecer", e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_STEAM_CATALOG_BUSY", payload: false });
    }
  };

  const handleExportSteamSeedManifest = async () => {
    if (state.steamCatalogBusy || state.steamSeedBusy) {
      toastError(
        "Operación bloqueada",
        "Por favor, espera a que terminen los procesos actuales antes de exportar a la nube."
      );
      return;
    }

    dispatch({ type: "SET_STEAM_SEED_BUSY", payload: true });
    try {
      const result = await exportSteamSeedManifestToCloud();
      toastSuccess(
        "Lista enviada a la nube",
        `Se subieron ${result.appIdsExported.toLocaleString()} juegos en ${result.partsUploaded} parte(s).`
      );
    } catch (e) {
      toastError("No se pudo enviar la lista", e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_STEAM_SEED_BUSY", payload: false });
    }
  };

  const handleResetCloudSeed = async () => {
    if (state.steamCatalogBusy || state.steamSeedBusy) {
      toastError(
        "Operación bloqueada",
        "Por favor, espera a que terminen los procesos actuales antes de borrar el progreso."
      );
      return;
    }

    dispatch({ type: "SET_STEAM_SEED_BUSY", payload: true });
    try {
      await resetCloudSeedState();
      toastSuccess(
        "Progreso en la nube reiniciado",
        "La próxima descarga volverá a empezar desde el principio (no borra lo que ya tienes guardado aquí)."
      );
      queryClient.invalidateQueries({ queryKey: STEAM_SEED_FRESHNESS_QUERY_KEY });
    } catch (e) {
      toastError("No se pudo reiniciar", e instanceof Error ? e.message : String(e));
    } finally {
      dispatch({ type: "SET_STEAM_SEED_BUSY", payload: false });
    }
  };

  const handleImportCloudSeedFromCloud = async () => {
    if (state.steamCatalogBusy || state.steamSeedBusy) {
      toastError(
        "Sincronización en curso",
        "Por favor, espera a que terminen los procesos actuales antes de descargar."
      );
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
        result.trendingPriorityEntries > 0 ? ` Orden de destacados: ${result.trendingPriorityEntries} juegos.` : "";
      toastSuccess(
        "Información descargada",
        `Se actualizaron ${result.rowsUpdated.toLocaleString()} juegos en ${result.batchesProcessed} lotes (${result.rounds} pasadas).${trending}`
      );
      queryClient.invalidateQueries({ queryKey: ["steamCatalog"] });
      queryClient.invalidateQueries({ queryKey: STEAM_SEED_FRESHNESS_QUERY_KEY });
    } catch (e) {
      toastError("No se pudo descargar la información", e instanceof Error ? e.message : String(e));
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
      await importSourceFromUrl(state.sourceUrl.trim(), mode);
      toastSuccess("Fuente importada", "Se importó correctamente desde URL.");
      dispatch({ type: "SET_SOURCE_URL", payload: "" });
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
    } catch (e) {
      toastError("Error al importar", e instanceof Error ? e.message : String(e));
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
      toastSuccess("Fuente importada", "Se importó correctamente desde archivo.");
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
    } catch (e) {
      toastError("Error al importar", e instanceof Error ? e.message : String(e));
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
        toastSuccess(`${result.succeeded} fuentes importadas`, `Se importaron todos los archivos correctamente.`);
      } else if (result.succeeded === 0) {
        toastError("Error al importar", `Ningún archivo se pudo importar. ${result.items[0]?.error ?? ""}`);
      } else {
        const updated = result.items.filter((i) => i.wasUpdated).length;
        const newOnes = result.succeeded - updated;
        toastSuccess(
          `${result.succeeded} importadas, ${result.failed} fallidas`,
          `${newOnes} nuevas, ${updated} actualizadas. ${result.failed > 0 ? "Revisa los detalles." : ""}`
        );
      }

      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
    } catch (e) {
      toastError("Error al importar", e instanceof Error ? e.message : String(e));
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
      toastSuccess("Ruta guardada", "Carpeta por defecto actualizada.");
    } catch (e) {
      toastError("Error al guardar ruta", e instanceof Error ? e.message : String(e));
    }
  };

  const handleDeleteSource = async (sourceId: string) => {
    setDeletingSourceIds((prev) => new Set(prev).add(sourceId));
    try {
      await removeSource(sourceId);
      toastSuccess("Fuente eliminada", "El catálogo ha sido eliminado correctamente.");
      queryClient.invalidateQueries({ queryKey: ["sources-catalogs"] });
    } catch (e) {
      toastError("Error al eliminar", e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingSourceIds((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
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
    setSourceUrl: (v: string) => dispatch({ type: "SET_SOURCE_URL", payload: v }),
    setDefaultSourceDownloadDir: (v: string) => dispatch({ type: "SET_DEFAULT_SOURCE_DOWNLOAD_DIR", payload: v }),
    handleImportSourceByUrl,
    handleImportSourceByFile,
    handleImportSourcesBatch,
    handleSelectDefaultSourceDownloadDir,
    handleSaveDefaultSourceDownloadDir,
    deletingSourceIds,
    handleDeleteSource,
  };
}
