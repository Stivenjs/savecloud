import type { NotificationRecord } from "@domain/entities/NotificationRecord";
import type { NotificationRepository } from "@domain/ports/NotificationRepository";
import type { NotificationChangeNotifier } from "@domain/ports/NotificationChangeNotifier";

export class AcknowledgeNotificationsUseCase {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly notificationChangeNotifier: NotificationChangeNotifier
  ) {}

  async execute(userId: string, ids: string[], read: boolean, dismiss: boolean): Promise<void> {
    if (ids.length === 0 || (!read && !dismiss)) return;

    const now = new Date().toISOString();
    const file = await this.notificationRepository.load(userId);
    const idSet = new Set(ids);
    let changed = false;
    const items: NotificationRecord[] = file.items.map((notification) => {
      if (!idSet.has(notification.id)) return notification;
      const shouldMarkRead = read && !notification.readAt;
      const shouldDismiss = dismiss && !notification.dismissedAt;
      if (!shouldMarkRead && !shouldDismiss) return notification;

      changed = true;
      return {
        ...notification,
        readAt: shouldMarkRead ? now : (notification.readAt ?? null),
        dismissedAt: shouldDismiss ? now : (notification.dismissedAt ?? null),
        updatedAt: now,
        syncVersion: notification.syncVersion + 1,
        serverUpdatedAt: now,
        pendingSync: false,
      };
    });

    if (!changed) return;
    await this.notificationRepository.save(userId, { version: 1, items });
    await this.notificationChangeNotifier.notifyChanged(userId, now);
  }
}
