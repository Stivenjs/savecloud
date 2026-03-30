import { invoke } from "@tauri-apps/api/core";

/** Alineado con `NotificationRecordDto` en Rust y `NotificationRecord` en la API. */
export interface NotificationRecord {
  id: string;
  userId: string;
  kind: string;
  severity: string;
  title: string;
  body: string;
  gameId?: string | null;
  operationId?: string | null;
  status?: string | null;
  reasonCode?: string | null;
  payloadJson?: string | null;
  dedupKey?: string | null;
  createdAt: string;
  updatedAt: string;
  readAt?: string | null;
  dismissedAt?: string | null;
  sourceDeviceId?: string | null;
  serverUpdatedAt?: string | null;
  pendingSync?: boolean;
  syncVersion: number;
}

export interface ListNotificationsParams {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
}

export async function listNotifications(params: ListNotificationsParams = {}): Promise<NotificationRecord[]> {
  const payload = {
    params: {
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
      unreadOnly: params.unreadOnly ?? false,
    },
  };
  try {
    const rows = await invoke<NotificationRecord[]>("list_notifications", payload);
    return rows;
  } catch (e) {
    throw e;
  }
}

export async function notificationUnreadCount(): Promise<number> {
  try {
    const n = await invoke<number>("notification_unread_count");
    return n;
  } catch (e) {
    throw e;
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  try {
    await invoke("mark_notification_read", { id });
  } catch (e) {
    throw e;
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  try {
    await invoke("mark_all_notifications_read");
  } catch (e) {
    throw e;
  }
}

export async function dismissNotification(id: string): Promise<void> {
  try {
    await invoke("dismiss_notification", { id });
  } catch (e) {
    throw e;
  }
}

export async function syncNotificationsPush(): Promise<number> {
  try {
    const n = await invoke<number>("sync_notifications_push");
    return n;
  } catch (e) {
    throw e;
  }
}

export async function syncNotificationsPull(): Promise<number> {
  try {
    const n = await invoke<number>("sync_notifications_pull");
    return n;
  } catch (e) {
    throw e;
  }
}
