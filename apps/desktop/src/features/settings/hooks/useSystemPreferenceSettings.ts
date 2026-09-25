import { useState, useCallback } from "react";
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import {
  checkForUpdatesWithPrompt,
  setFullBackupStreaming,
  setFullBackupStreamingDryRun,
  setFullBackupPackagedCompressionLevel,
  setDeveloperMode,
  setAutoExtractDownloads,
  scheduleConfigBackupToCloud,
} from "@services/tauri";
import { getAlwaysShowSelectorCmd, setAlwaysShowSelectorCmd } from "@services/tauri/profile.service";
import { useProfileSessionStore } from "@store/ProfileSessionStore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toastError, toastSuccess } from "@utils/toast";
import { notifyTest } from "@utils/notification";
import i18n from "@lib/i18n";

export function useSystemPreferenceSettings() {
  const queryClient = useQueryClient();

  const [testingNotification, setTestingNotification] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

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

  const handleCheckUpdates = async () => {
    setCheckingUpdate(true);
    try {
      await checkForUpdatesWithPrompt();
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleTestNotification = async () => {
    setTestingNotification(true);
    try {
      const ok = await notifyTest();
      if (!ok) {
        alert("Los permisos para notificaciones no están concedidos. Revisa la configuración del sistema.");
      }
    } finally {
      setTestingNotification(false);
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
        i18n.t("settings.toast.compressionSaved"),
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

  return {
    autostart,
    alwaysShowProfileSelector,
    loading: loadingAutostart,
    loadingAlwaysShowProfileSelector,
    testingNotification,
    checkingUpdate,
    handleCheckUpdates,
    handleTestNotification,
    handleAutostartChange,
    handleAlwaysShowProfileSelectorChange,
    handleFullBackupStreamingChange,
    handleFullBackupStreamingDryRunChange,
    handleFullBackupPackagedCompressionLevelChange,
    handleDeveloperModeChange,
    handleAutoExtractDownloadsChange,
  };
}
