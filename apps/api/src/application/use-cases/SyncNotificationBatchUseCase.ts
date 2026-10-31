import type { NotificationRecord } from "@domain/entities/NotificationRecord";
import type { NotificationRepository } from "@domain/ports/NotificationRepository";
import type { NotificationChangeNotifier } from "@domain/ports/NotificationChangeNotifier";
import { mergeNotificationRecords } from "@domain/services/notification-merge";

export class SyncNotificationBatchUseCase {
  constructor(
    private readonly notificationRepository: NotificationRepository,
    private readonly notificationChangeNotifier: NotificationChangeNotifier
  ) {}

  /**
   * Sincroniza las notificaciones propias del usuario y avisa solo cuando el almacén acepta cambios.
   * Los repositorios sin soporte para lotes directos conservan la fusión anterior del inbox.
   */
  async execute(userId: string, incoming: NotificationRecord[]): Promise<void> {
    const ownedRecords = incoming.filter((record) => record.userId === userId);
    if (ownedRecords.length === 0) return;

    const now = new Date().toISOString();
    const recordsWithServerTime = ownedRecords.map((record) => ({
      ...record,
      serverUpdatedAt: now,
      pendingSync: false,
    }));

    if (this.notificationRepository.syncBatch) {
      const changed = await this.notificationRepository.syncBatch(userId, recordsWithServerTime);
      if (changed) await this.notificationChangeNotifier.notifyChanged(userId, now);
      return;
    }

    const file = await this.notificationRepository.load(userId);
    const changed = ownedRecords.some((candidate) => {
      const previous = file.items.find((item) => item.id === candidate.id);
      return (
        !previous ||
        candidate.syncVersion > previous.syncVersion ||
        (candidate.syncVersion === previous.syncVersion && candidate.updatedAt > previous.updatedAt)
      );
    });

    if (!changed) return;
    await this.notificationRepository.save(userId, {
      version: 1,
      items: mergeNotificationRecords(file.items, recordsWithServerTime),
    });
    await this.notificationChangeNotifier.notifyChanged(userId, now);
  }
}
