import { useEffect, useReducer, useState } from "react";
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
} from "@services/tauri";
import { useConfig } from "@hooks/useConfig";
import { useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "@utils/toast";
import { notifyTest } from "@utils/notification";

type SettingsPageState = {
  autostart: boolean;
  loading: boolean;
  testingNotification: boolean;
  exporting: boolean;
  importing: boolean;
  checkingUpdate: boolean;
  configPath: string;
  createConfigModalOpen: boolean;
  createApiBaseUrl: string;
  createApiKey: string;
  createUserId: string;
  creatingConfig: boolean;
  createConfigError: string | null;
  backingUpConfig: boolean;
  restoringConfig: boolean;
  restoreConfirmOpen: boolean;
};

type SettingsPageAction =
  | { type: "SET_AUTOSTART"; payload: boolean }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_TESTING_NOTIFICATION"; payload: boolean }
  | { type: "SET_EXPORTING"; payload: boolean }
  | { type: "SET_IMPORTING"; payload: boolean }
  | { type: "SET_CHECKING_UPDATE"; payload: boolean }
  | { type: "SET_CONFIG_PATH"; payload: string }
  | {
      type: "SET_CREATE_MODAL";
      open: boolean;
      apiBaseUrl?: string;
      apiKey?: string;
      userId?: string;
    }
  | {
      type: "SET_CREATE_FORM_FROM_CONFIG";
      apiBaseUrl: string;
      apiKey: string;
      userId: string;
    }
  | { type: "SET_CREATE_API_BASE_URL"; payload: string }
  | { type: "SET_CREATE_API_KEY"; payload: string }
  | { type: "SET_CREATE_USER_ID"; payload: string }
  | { type: "SET_CREATING_CONFIG"; payload: boolean }
  | { type: "SET_CREATE_CONFIG_ERROR"; payload: string | null }
  | { type: "SET_BACKING_UP_CONFIG"; payload: boolean }
  | { type: "SET_RESTORING_CONFIG"; payload: boolean }
  | { type: "SET_RESTORE_CONFIRM_OPEN"; payload: boolean };

const initialState: SettingsPageState = {
  autostart: false,
  loading: true,
  testingNotification: false,
  exporting: false,
  importing: false,
  checkingUpdate: false,
  configPath: "",
  createConfigModalOpen: false,
  createApiBaseUrl: "",
  createApiKey: "",
  createUserId: "",
  creatingConfig: false,
  createConfigError: null,
  backingUpConfig: false,
  restoringConfig: false,
  restoreConfirmOpen: false,
};

function settingsPageReducer(
  state: SettingsPageState,
  action: SettingsPageAction
): SettingsPageState {
  switch (action.type) {
    case "SET_AUTOSTART":
      return { ...state, autostart: action.payload };
    case "SET_LOADING":
      return { ...state, loading: action.payload };
    case "SET_TESTING_NOTIFICATION":
      return { ...state, testingNotification: action.payload };
    case "SET_EXPORTING":
      return { ...state, exporting: action.payload };
    case "SET_IMPORTING":
      return { ...state, importing: action.payload };
    case "SET_CHECKING_UPDATE":
      return { ...state, checkingUpdate: action.payload };
    case "SET_CONFIG_PATH":
      return { ...state, configPath: action.payload };
    case "SET_CREATE_MODAL":
      return {
        ...state,
        createConfigModalOpen: action.open,
        ...(action.apiBaseUrl !== undefined && {
          createApiBaseUrl: action.apiBaseUrl,
        }),
        ...(action.apiKey !== undefined && { createApiKey: action.apiKey }),
        ...(action.userId !== undefined && { createUserId: action.userId }),
        ...(action.open && { createConfigError: null }),
      };
    case "SET_CREATE_FORM_FROM_CONFIG":
      return {
        ...state,
        createApiBaseUrl: action.apiBaseUrl,
        createApiKey: action.apiKey,
        createUserId: action.userId,
      };
    case "SET_CREATE_API_BASE_URL":
      return { ...state, createApiBaseUrl: action.payload };
    case "SET_CREATE_API_KEY":
      return { ...state, createApiKey: action.payload };
    case "SET_CREATE_USER_ID":
      return { ...state, createUserId: action.payload };
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
    default:
      return state;
  }
}

export function useSettingsPage() {
  const [state, dispatch] = useReducer(settingsPageReducer, initialState);
  const { config, refetch: refetchConfig } = useConfig();
  const queryClient = useQueryClient();

  useEffect(() => {
    isEnabled()
      .then((enabled) => dispatch({ type: "SET_AUTOSTART", payload: enabled }))
      .finally(() => dispatch({ type: "SET_LOADING", payload: false }));
  }, []);

  useEffect(() => {
    getConfigPath().then((path) =>
      dispatch({ type: "SET_CONFIG_PATH", payload: path })
    );
  }, []);

  useEffect(() => {
    if (state.createConfigModalOpen && config) {
      dispatch({
        type: "SET_CREATE_FORM_FROM_CONFIG",
        apiBaseUrl: config.apiBaseUrl ?? "",
        apiKey: config.apiKey ?? "",
        userId: config.userId ?? "",
      });
    }
  }, [
    state.createConfigModalOpen,
    config?.apiBaseUrl,
    config?.apiKey,
    config?.userId,
  ]);

  const handleExportConfig = async () => {
    dispatch({ type: "SET_EXPORTING", payload: true });
    try {
      const path = await save({
        title: "Exportar configuración",
        defaultPath: "sync-games-config.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (path) {
        await exportConfigToFile(path);
        toastSuccess("Configuración exportada", path);
      }
    } catch (e) {
      toastError(
        "Error al exportar",
        e instanceof Error ? e.message : String(e)
      );
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
          "Configuración importada",
          mode === "merge" ? "Juegos fusionados" : "Configuración reemplazada"
        );
        window.location.reload();
      }
    } catch (e) {
      toastError(
        "Error al importar",
        e instanceof Error ? e.message : String(e)
      );
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
      toastSuccess(
        "Configuración respaldada",
        "Se subió config.json a la nube para este usuario."
      );
    } catch (e) {
      toastError(
        "Error al respaldar",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      dispatch({ type: "SET_BACKING_UP_CONFIG", payload: false });
    }
  };

  const performRestoreConfigFromCloud = async () => {
    dispatch({ type: "SET_RESTORING_CONFIG", payload: true });
    try {
      await restoreConfigFromCloud();
      toastSuccess(
        "Configuración restaurada",
        "Se aplicó la configuración desde la nube."
      );
      window.location.reload();
    } catch (e) {
      toastError(
        "Error al restaurar",
        e instanceof Error ? e.message : String(e)
      );
    } finally {
      dispatch({ type: "SET_RESTORING_CONFIG", payload: false });
    }
  };

  const handleTestNotification = async () => {
    dispatch({ type: "SET_TESTING_NOTIFICATION", payload: true });
    try {
      const ok = await notifyTest();
      if (!ok) {
        alert(
          "Los permisos para notificaciones no están concedidos. Revisa la configuración del sistema."
        );
      }
    } finally {
      dispatch({ type: "SET_TESTING_NOTIFICATION", payload: false });
    }
  };

  const handleCreateConfigFile = async () => {
    dispatch({ type: "SET_CREATING_CONFIG", payload: true });
    dispatch({ type: "SET_CREATE_CONFIG_ERROR", payload: null });
    try {
      const path = await createConfigFile(
        state.createApiBaseUrl,
        state.createApiKey,
        state.createUserId
      );
      toastSuccess("Archivo de configuración creado", path);
      dispatch({ type: "SET_CREATE_MODAL", open: false });
      scheduleConfigBackupToCloud();
      refetchConfig?.();
      queryClient.invalidateQueries({ queryKey: ["config"] });
      const newPath = await getConfigPath();
      dispatch({ type: "SET_CONFIG_PATH", payload: newPath });
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
      dispatch({ type: "SET_AUTOSTART", payload: checked });
    } catch (e) {
      console.error("Error al cambiar autostart:", e);
    }
  };

  const openCreateConfigModal = () => {
    dispatch({ type: "SET_CREATE_CONFIG_ERROR", payload: null });
    dispatch({ type: "SET_CREATE_MODAL", open: true });
  };

  const [s3TransferEndpointType, setS3TransferEndpointType] = useState<
    "accelerated" | "standard" | "unknown" | null
  >(null);
  useEffect(() => {
    if (!config?.apiBaseUrl?.trim() || !config?.userId?.trim()) {
      setS3TransferEndpointType(null);
      return;
    }
    getS3TransferEndpointType()
      .then(setS3TransferEndpointType)
      .catch(() => setS3TransferEndpointType("unknown"));
  }, [config?.apiBaseUrl, config?.userId]);

  return {
    ...state,
    config,
    s3TransferEndpointType,
    handleExportConfig,
    handleImportConfig,
    handleCheckUpdates,
    handleBackupConfigToCloud,
    performRestoreConfigFromCloud,
    handleTestNotification,
    handleCreateConfigFile,
    handleAutostartChange,
    openCreateConfigModal,
    setCreateApiBaseUrl: (v: string) =>
      dispatch({ type: "SET_CREATE_API_BASE_URL", payload: v }),
    setCreateApiKey: (v: string) =>
      dispatch({ type: "SET_CREATE_API_KEY", payload: v }),
    setCreateUserId: (v: string) =>
      dispatch({ type: "SET_CREATE_USER_ID", payload: v }),
    setCreateConfigModalOpen: (open: boolean) =>
      dispatch({ type: "SET_CREATE_MODAL", open }),
    setRestoreConfirmOpen: (v: boolean) =>
      dispatch({ type: "SET_RESTORE_CONFIRM_OPEN", payload: v }),
  };
}
