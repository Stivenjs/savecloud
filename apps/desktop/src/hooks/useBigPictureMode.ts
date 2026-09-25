import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import { useConfig, CONFIG_QUERY_KEY } from "@/hooks/useConfig";
import {
  scheduleConfigBackupToCloud,
  setStartupWindowMode,
  type StartupWindowMode,
} from "@services/tauri/config.service";
import { toastError, toastSuccess } from "@/utils/toast";
import i18n from "@lib/i18n";
import { isBigPictureWindowOpen, openOrFocusBigPictureWindow, switchToNormalMode } from "@/windows/bigPictureWindow";

export function useBigPictureMode() {
  const { config, loading } = useConfig();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [bigPictureActive, setBigPictureActive] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);

  const startupMode: StartupWindowMode = config?.startupWindowMode === "big_picture" ? "big_picture" : "normal";

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void isBigPictureWindowOpen().then((isOpen) => {
      if (cancelled) return;
      try {
        setBigPictureActive(isOpen);
      } catch {
        if (!cancelled) setBigPictureActive(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeStartupMode = useCallback(
    async (mode: StartupWindowMode) => {
      if (!isTauri()) return;
      setSaving(true);
      try {
        await setStartupWindowMode(mode);
        await queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
        scheduleConfigBackupToCloud();
        toastSuccess(
          i18n.t("settings.bigPicture.toast.preferenceSaved"),
          mode === "big_picture"
            ? i18n.t("settings.bigPicture.toast.nextTimeBigPicture")
            : i18n.t("settings.bigPicture.toast.nextTimeNormal")
        );
      } catch (e) {
        toastError(i18n.t("settings.bigPicture.toast.cannotSave"), e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [queryClient]
  );

  const toggleNow = useCallback(async () => {
    if (!isTauri()) return;
    setToggleBusy(true);
    try {
      if (bigPictureActive) {
        await switchToNormalMode();
        setBigPictureActive(false);
        toastSuccess(
          i18n.t("settings.bigPicture.toast.normalMode"),
          i18n.t("settings.bigPicture.toast.normalModeDesc")
        );
      } else {
        await openOrFocusBigPictureWindow();
        setBigPictureActive(true);
        toastSuccess(
          i18n.t("settings.bigPicture.toast.bigPictureTitle"),
          i18n.t("settings.bigPicture.toast.bigPictureDesc")
        );
      }
    } catch (e) {
      toastError(i18n.t("settings.bigPicture.toast.cannotChangeMode"), e instanceof Error ? e.message : String(e));
    } finally {
      setToggleBusy(false);
    }
  }, [bigPictureActive]);

  return {
    isDesktop: isTauri(),
    loading,
    saving,
    toggleBusy,
    startupMode,
    bigPictureActive,
    changeStartupMode,
    toggleNow,
  };
}
