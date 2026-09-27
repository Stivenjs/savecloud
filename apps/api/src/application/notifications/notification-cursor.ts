const CURSOR_SEPARATOR = "|";

export interface NotificationCursor {
  updatedAt: string;
  id: string;
}

export function parseNotificationCursor(cursor: string): NotificationCursor {
  const separatorIndex = cursor.indexOf(CURSOR_SEPARATOR);
  if (separatorIndex < 0) return { updatedAt: cursor, id: "" };
  return {
    updatedAt: cursor.slice(0, separatorIndex),
    id: cursor.slice(separatorIndex + CURSOR_SEPARATOR.length),
  };
}

export function compareNotificationCursors(left: NotificationCursor, right: NotificationCursor): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt.localeCompare(right.updatedAt);
  return left.id.localeCompare(right.id);
}

export function createNotificationCursor(updatedAt: string, id: string): string {
  return `${updatedAt}${CURSOR_SEPARATOR}${id}`;
}
