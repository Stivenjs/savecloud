import { create } from "zustand";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  dismissNotification,
  notificationUnreadCount,
  syncNotificationsPull,
  syncNotificationsPush,
  type NotificationRecord,
} from "@services/tauri/notifications.service";

interface NotificationStoreState {
  unreadCount: number;
  items: NotificationRecord[];
  loading: boolean;
  setUnreadCount: (n: number) => void;
  refreshUnreadCount: () => Promise<void>;
  /** Carga lista para el panel. `silent`: no pone loading (evita ocultar la lista al refrescar tras sync). */
  loadItems: (opts?: { unreadOnly?: boolean; silent?: boolean }) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  /** Sincroniza con la API (requiere userId + API configurados). */
  syncWithCloud: () => Promise<void>;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  unreadCount: 0,
  items: [],
  loading: false,

  setUnreadCount: (n) => set({ unreadCount: n }),

  refreshUnreadCount: async () => {
    try {
      const n = await notificationUnreadCount();
      set({ unreadCount: n });
    } catch (e) {
      // Si no hay userId/API configurados, simplemente no actualizamos el badge.
    }
  },

  loadItems: async (opts) => {
    if (!opts?.silent) {
      set({ loading: true });
    }
    try {
      const items = await listNotifications({
        limit: 80,
        offset: 0,
        unreadOnly: opts?.unreadOnly ?? false,
      });
      set({ items });
    } catch (e) {
      // Fallo al listar: no interrumpimos la UI.
    } finally {
      if (!opts?.silent) {
        set({ loading: false });
      }
    }
  },

  markRead: async (id) => {
    await markNotificationRead(id);
    await get().refreshUnreadCount();
    await get().loadItems({ unreadOnly: false, silent: true });
  },

  markAllRead: async () => {
    await markAllNotificationsRead();
    set({ unreadCount: 0 });
    await get().loadItems({ unreadOnly: false, silent: true });
  },

  dismiss: async (id) => {
    await dismissNotification(id);
    await get().refreshUnreadCount();
    await get().loadItems({ unreadOnly: false, silent: true });
  },

  syncWithCloud: async () => {
    set({ loading: true });
    try {
      try {
        await syncNotificationsPush();
        await syncNotificationsPull();
      } catch (e) {
        // Si falla push/pull (red/API), mantenemos el listado local.
      }
      await get().refreshUnreadCount();
      const items = await listNotifications({
        limit: 80,
        offset: 0,
        unreadOnly: false,
      });
      set({ items });
    } catch (e) {
      try {
        const items = await listNotifications({
          limit: 80,
          offset: 0,
          unreadOnly: false,
        });
        set({ items });
      } catch (e2) {
        // Si falla incluso el reintento, dejamos la lista como estaba.
      }
    } finally {
      set({ loading: false });
    }
  },
}));
