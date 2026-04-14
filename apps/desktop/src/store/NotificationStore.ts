import { create } from "zustand";
import { syncNotificationsFull } from "@services/tauri/notifications.service";
import { queryClient } from "@lib/queryClient";
import { NOTIFICATION_KEYS } from "@hooks/queries/useNotificationsQueries";

interface NotificationStoreState {
  lastSyncTime: number;
  /**
   * Sincroniza con la API.
   * Se mantiene en el store para ser llamado desde hooks globales como useAppInitialization
   * de forma centralizada y protegida por cooldown.
   */
  syncWithCloud: () => Promise<void>;
  /** Refresca solo el contador (útil para el badge) */
  refreshUnreadCount: () => Promise<void>;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  lastSyncTime: 0,

  refreshUnreadCount: async () => {
    await queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.unreadCount() });
  },

  syncWithCloud: async () => {
    const now = Date.now();
    // Protección contra ráfagas y concurrencia.
    // Usamos el estado interno de Query para saber si ya hay algo en vuelo.
    const isFetching = queryClient.isFetching({ queryKey: NOTIFICATION_KEYS.all }) > 0;

    if (isFetching || now - get().lastSyncTime < 2000) return;

    set({ lastSyncTime: now });

    try {
      const res = await syncNotificationsFull({
        limit: 80,
        offset: 0,
        unreadOnly: false,
      });

      // Actualizamos la caché de React Query manualmente con el resultado atómico
      queryClient.setQueryData(NOTIFICATION_KEYS.list(), res.items);
      queryClient.setQueryData(NOTIFICATION_KEYS.unreadCount(), res.unreadCount);
    } catch (e) {
      // Si el sync atómico falla, forzamos un refetch de los datos locales
      await queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    }
  },
}));
