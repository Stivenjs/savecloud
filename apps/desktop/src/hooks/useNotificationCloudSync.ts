import { listen } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { visibilityManager } from "@hooks/useAppVisibility";
import { NOTIFICATIONS_CHANGED_EVENT } from "@services/tauri/notifications.service";
import { useNotificationStore } from "@store/NotificationStore";

interface CloudWsNotification {
  type?: string;
}

/** Sincroniza los cambios de notificaciones al iniciar, reconectar y volver a la app. */
export function useNotificationCloudSync(): void {
  useEffect(() => {
    let active = true;
    const sync = () => {
      if (active) void useNotificationStore.getState().syncWithCloud();
    };

    let unlistenLocal: (() => void) | undefined;
    let unlistenCloud: (() => void) | undefined;
    let unlistenConnected: (() => void) | undefined;

    void listen(NOTIFICATIONS_CHANGED_EVENT, sync).then((unlisten) => {
      if (active) unlistenLocal = unlisten;
      else unlisten();
    });
    void listen<CloudWsNotification>("cloud-ws-incoming", ({ payload }) => {
      if (payload.type === "NOTIFICATIONS_CHANGED") sync();
    }).then((unlisten) => {
      if (active) unlistenCloud = unlisten;
      else unlisten();
    });
    void listen("cloud-ws-connected", sync).then((unlisten) => {
      if (active) unlistenConnected = unlisten;
      else unlisten();
    });

    const unsubscribeVisibility = visibilityManager.subscribe(() => {}, sync);
    sync();

    return () => {
      active = false;
      unsubscribeVisibility();
      unlistenLocal?.();
      unlistenCloud?.();
      unlistenConnected?.();
    };
  }, []);
}
