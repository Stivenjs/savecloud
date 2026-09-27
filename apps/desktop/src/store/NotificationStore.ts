import { create } from "zustand";
import { syncNotificationsFull } from "@services/tauri/notifications.service";
import { queryClient } from "@lib/queryClient";
import { NOTIFICATION_KEYS } from "@hooks/queries/useNotificationsQueries";

let syncInFlight: Promise<void> | null = null;
let syncRequestedDuringFlight = false;

interface NotificationStoreState {
  /**
   * Sincroniza con la API.
   * Se mantiene en el store para ser llamado desde hooks globales como useAppInitialization
   * de forma centralizada y agrupando solicitudes simultáneas.
   */
  syncWithCloud: () => Promise<void>;
  /** Refresca solo el contador (útil para el badge) */
  refreshUnreadCount: () => Promise<void>;
}

export const useNotificationStore = create<NotificationStoreState>((_set, get) => ({
  refreshUnreadCount: async () => {
    await queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.unreadCount() });
  },

  syncWithCloud: () => {
    if (syncInFlight) {
      syncRequestedDuringFlight = true;
      return syncInFlight;
    }

    syncInFlight = (async () => {
      do {
        syncRequestedDuringFlight = false;

        try {
          const res = await syncNotificationsFull({
            limit: 80,
            offset: 0,
            unreadOnly: false,
          });

          queryClient.setQueryData(NOTIFICATION_KEYS.list(), res.items);
          queryClient.setQueryData(NOTIFICATION_KEYS.unreadCount(), res.unreadCount);
        } catch {
          await queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
        }
      } while (syncRequestedDuringFlight);
    })().finally(() => {
      syncInFlight = null;
      if (syncRequestedDuringFlight) {
        syncRequestedDuringFlight = false;
        void get().syncWithCloud();
      }
    });

    return syncInFlight;
  },
}));
