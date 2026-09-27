import type { NotificationRecord } from "@domain/entities/NotificationRecord";
import type { NotificationRepository } from "@domain/ports/NotificationRepository";
import {
  compareNotificationCursors,
  createNotificationCursor,
  parseNotificationCursor,
} from "@application/notifications/notification-cursor";

export interface ListNotificationsOutput {
  items: NotificationRecord[];
  nextCursor?: string;
}

export class ListNotificationsUseCase {
  constructor(private readonly notificationRepository: NotificationRepository) {}

  async execute(userId: string, cursor: string, requestedLimit: number): Promise<ListNotificationsOutput> {
    const { items } = await this.notificationRepository.load(userId);
    if (items.length === 0) return { items: [] };

    const cursorPosition = cursor ? parseNotificationCursor(cursor) : null;
    const records = items
      .map((item) => ({
        item,
        position: { updatedAt: item.serverUpdatedAt ?? item.updatedAt, id: item.id },
      }))
      .filter(({ position }) => !cursorPosition || compareNotificationCursors(position, cursorPosition) > 0)
      .sort((left, right) => compareNotificationCursors(left.position, right.position));

    const page = records.slice(0, Math.min(requestedLimit, 200));
    const resultItems = page.map(({ item, position }) => ({
      ...item,
      serverUpdatedAt: item.serverUpdatedAt ?? position.updatedAt,
    }));
    const last = page.at(-1);

    return {
      items: resultItems,
      nextCursor: last ? createNotificationCursor(last.position.updatedAt, last.position.id) : undefined,
    };
  }
}
