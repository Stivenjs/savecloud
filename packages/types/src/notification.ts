/**
 * Registro de notificación alineado con el cliente Tauri (`NotificationRecordDto`).
 */
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

export interface NotificationInboxFile {
  version: 1;
  items: NotificationRecord[];
}
