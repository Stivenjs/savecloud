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
          "Preferencia guardada",
          mode === "big_picture"
            ? "La próxima vez Savecloud abrirá en la ventana Big Picture."
            : "La próxima vez Savecloud abrirá en ventana normal."
        );
      } catch (e) {
        toastError("No se pudo guardar", e instanceof Error ? e.message : String(e));
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
        toastSuccess("Modo normal", "Se cerró Big Picture y volvió la ventana principal.");
      } else {
        await openOrFocusBigPictureWindow();
        setBigPictureActive(true);
        toastSuccess("Big Picture", "La ventana principal se ocultó al tray y se abrió Big Picture.");
      }
    } catch (e) {
      toastError("No se pudo cambiar el modo", e instanceof Error ? e.message : String(e));
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
