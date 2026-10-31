import type { NotificationInboxFile, NotificationRecord } from "@domain/entities/NotificationRecord";

/** Define las operaciones de persistencia del inbox de notificaciones. */
export interface NotificationRepository {
  load(userId: string): Promise<NotificationInboxFile>;
  save(userId: string, file: NotificationInboxFile): Promise<void>;
  /** Sincroniza un lote directamente y devuelve si al menos un registro cambió. */
  syncBatch?(userId: string, items: NotificationRecord[]): Promise<boolean>;
}
