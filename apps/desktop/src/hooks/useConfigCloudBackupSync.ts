import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { visibilityManager } from "@hooks/useAppVisibility";
import { backupConfigToCloudIfChanged } from "@services/tauri/config.service";

/** Reintenta respaldos pendientes al iniciar, reconectar y volver a la app. */
export function useConfigCloudBackupSync(): void {
  useEffect(() => {
    let active = true;
    const checkBackup = () => {
      if (active) void backupConfigToCloudIfChanged().catch(() => {});
    };

    let unlistenConnected: (() => void) | undefined;
    void listen("cloud-ws-connected", checkBackup).then((unlisten) => {
      if (active) unlistenConnected = unlisten;
      else unlisten();
    });

    const unsubscribeVisibility = visibilityManager.subscribe(() => {}, checkBackup);
    window.addEventListener("online", checkBackup);
    checkBackup();

    return () => {
      active = false;
      unsubscribeVisibility();
      window.removeEventListener("online", checkBackup);
      unlistenConnected?.();
    };
  }, []);
}
