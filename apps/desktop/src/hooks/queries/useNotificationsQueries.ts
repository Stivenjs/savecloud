import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listNotifications,
  notificationUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
  dismissAllNotifications,
  syncNotificationsFull,
} from "@services/tauri/notifications.service";

export const NOTIFICATION_KEYS = {
  all: ["notifications"] as const,
  list: () => [...NOTIFICATION_KEYS.all, "list"] as const,
  unreadCount: () => [...NOTIFICATION_KEYS.all, "unread-count"] as const,
};

/**
 * Hook para obtener la lista de notificaciones con caché.
 */
export function useNotificationsQuery() {
  return useQuery({
    queryKey: NOTIFICATION_KEYS.list(),
    queryFn: () => listNotifications({ limit: 80, offset: 0, unreadOnly: false }),
    staleTime: 60_000, // 1 minuto de caché fresca
  });
}

/**
 * Hook para obtener el contador de no leídas.
 */
export function useUnreadCountQuery() {
  return useQuery({
    queryKey: NOTIFICATION_KEYS.unreadCount(),
    queryFn: () => notificationUnreadCount(),
    staleTime: 60_000,
  });
}

/**
 * Hook para gestionar acciones (marcar leído, borrar).
 */
export function useNotificationActions() {
  const queryClient = useQueryClient();

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissNotification(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    },
  });

  const dismissAllMutation = useMutation({
    mutationFn: () => dismissAllNotifications(),
    onSuccess: () => {
      queryClient.setQueryData(NOTIFICATION_KEYS.list(), []);
      queryClient.setQueryData(NOTIFICATION_KEYS.unreadCount(), 0);
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () => syncNotificationsFull({ limit: 80, offset: 0, unreadOnly: false }),
    onSuccess: (data) => {
      // Actualizamos la caché directamente con la respuesta atómica del backend
      queryClient.setQueryData(NOTIFICATION_KEYS.list(), data.items);
      queryClient.setQueryData(NOTIFICATION_KEYS.unreadCount(), data.unreadCount);
    },
  });

  return {
    markRead: markReadMutation.mutateAsync,
    markAllRead: markAllReadMutation.mutateAsync,
    dismiss: dismissMutation.mutateAsync,
    dismissAll: dismissAllMutation.mutateAsync,
    syncWithCloud: syncMutation.mutateAsync,
    isSyncing: syncMutation.isPending,
  };
}
