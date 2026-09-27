import type { NotificationInboxFile } from "@domain/entities/NotificationRecord";

/** Define las operaciones de persistencia del inbox de notificaciones. */
export interface NotificationRepository {
  load(userId: string): Promise<NotificationInboxFile>;
  save(userId: string, file: NotificationInboxFile): Promise<void>;
}
