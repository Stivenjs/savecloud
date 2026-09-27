import type { NotificationRecord } from "@domain/entities/NotificationRecord";

const MAX_ITEMS = 500;

/** Resuelve conflictos de sincronización usando syncVersion y updatedAt. */
export function mergeNotificationRecord(a: NotificationRecord, b: NotificationRecord): NotificationRecord {
  if (b.syncVersion !== a.syncVersion) {
    return b.syncVersion > a.syncVersion ? b : a;
  }
  return b.updatedAt > a.updatedAt ? b : a;
}

/** Combina registros por ID y conserva los 500 más recientes. */
export function mergeNotificationRecords(
  existing: NotificationRecord[],
  incoming: NotificationRecord[]
): NotificationRecord[] {
  const recordsById = new Map<string, NotificationRecord>();
  for (const record of existing) recordsById.set(record.id, record);
  for (const record of incoming) {
    const previous = recordsById.get(record.id);
    recordsById.set(record.id, previous ? mergeNotificationRecord(previous, record) : record);
  }

  return [...recordsById.values()]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_ITEMS);
}
