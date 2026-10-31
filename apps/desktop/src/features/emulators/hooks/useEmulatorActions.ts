import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { downloadEmulator, setEmulatorPath, type EmulatorProgressPayload } from "@services/tauri/emulators.service";
import { getUnknownErrorMessage } from "@utils/errorMessage";
import type { EmulatorProgressById } from "../types/emulatorCatalog";

interface UseEmulatorActionsOptions {
  setProgresses: Dispatch<SetStateAction<EmulatorProgressById>>;
  refreshStatus: () => void;
}

/** Acciones de instalación, selección de ejecutable y navegación a enlaces oficiales. */
export function useEmulatorActions({ setProgresses, refreshStatus }: UseEmulatorActionsOptions) {
  const { t } = useTranslation();

  const pickExecutable = useCallback(
    async (emulatorId: string, emulatorName: string) => {
      try {
        const selected = await open({
          directory: false,
          multiple: false,
          title: t("settings.emulators.selectExecutableTitle", { name: emulatorName }),
          filters: [{ name: t("settings.emulators.allFilesFilter"), extensions: ["*"] }],
        });
        if (typeof selected === "string" && selected.length > 0) {
          await setEmulatorPath(emulatorId, selected);
          refreshStatus();
        }
      } catch (error) {
        console.error("No se pudo seleccionar el ejecutable del emulador:", error);
      }
    },
    [refreshStatus, t]
  );

  const install = useCallback(
    async (emulatorId: string) => {
      setProgresses((previous) => ({
        ...previous,
        [emulatorId]: {
          emulator: emulatorId,
          status: "downloading",
          loaded: 0,
          total: 0,
          speed: 0,
          eta: null,
        },
      }));

      try {
        await downloadEmulator(emulatorId);
      } catch (error) {
        const failedProgress: EmulatorProgressPayload = {
          emulator: emulatorId,
          status: "failed",
          loaded: 0,
          total: 0,
          error: getUnknownErrorMessage(error),
        };
        setProgresses((previous) => ({ ...previous, [emulatorId]: failedProgress }));
      }
    },
    [setProgresses]
  );

  const openExternal = useCallback(async (url: string) => {
    try {
      await openUrl(url);
    } catch (error) {
      console.error("No se pudo abrir el enlace del emulador:", error);
    }
  }, []);

  return { pickExecutable, install, openExternal };
}
