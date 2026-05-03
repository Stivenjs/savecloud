import { useCallback, useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useQueryClient } from "@tanstack/react-query";
import { useConfig, CONFIG_QUERY_KEY } from "@/hooks/useConfig";
import {
  scheduleConfigBackupToCloud,
  setStartupWindowMode,
  type StartupWindowMode,
} from "@services/tauri/config.service";
import { toastError, toastSuccess } from "@/utils/toast";

export function useBigPictureMode() {
  const { config, loading } = useConfig();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [mainFullscreen, setMainFullscreen] = useState<boolean | null>(null);
  const [toggleBusy, setToggleBusy] = useState(false);

  const startupMode: StartupWindowMode = config?.startupWindowMode === "big_picture" ? "big_picture" : "normal";

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void WebviewWindow.getByLabel("main").then(async (mainWindow) => {
      if (!mainWindow || cancelled) return;
      try {
        const fullscreen = await mainWindow.isFullscreen();
        if (!cancelled) setMainFullscreen(fullscreen);
      } catch {
        if (!cancelled) setMainFullscreen(null);
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
            ? "La próxima vez Savecloud abrirá en pantalla completa (anúlalo una vez con Shift/Ctrl/Alt al arrancar)."
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
      const mainWindow = await WebviewWindow.getByLabel("main");
      if (!mainWindow) {
        toastError("Ventana principal", "No se encontró la ventana «main».");
        return;
      }
      const fullscreen = await mainWindow.isFullscreen();
      await mainWindow.setFullscreen(!fullscreen);
      setMainFullscreen(!fullscreen);
      toastSuccess(
        fullscreen ? "Ventana normal" : "Big Picture",
        fullscreen ? "Saliste de pantalla completa." : "Pantalla completa activada."
      );
    } catch (e) {
      toastError("No se pudo cambiar el modo", e instanceof Error ? e.message : String(e));
    } finally {
      setToggleBusy(false);
    }
  }, []);

  return {
    isDesktop: isTauri(),
    loading,
    saving,
    toggleBusy,
    startupMode,
    mainFullscreen,
    changeStartupMode,
    toggleNow,
  };
}
