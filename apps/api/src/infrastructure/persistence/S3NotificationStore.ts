import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import type { NotificationInboxFile, NotificationRecord } from "@domain/entities/NotificationRecord";

const MAX_ITEMS = 500;

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404;
}

/**
 * Persistencia del inbox de notificaciones por usuario en un único JSON en S3.
 */
export class S3NotificationStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucketName: string
  ) {}

  private key(userId: string): string {
    return `notifications/${userId}/notifications.json`;
  }

  async load(userId: string): Promise<NotificationInboxFile> {
    try {
      const res = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: this.key(userId),
        })
      );
      const raw = await res.Body?.transformToString();
      if (!raw?.trim()) {
        return { version: 1, items: [] };
      }
      const parsed = JSON.parse(raw) as NotificationInboxFile;
      if (!parsed.items || !Array.isArray(parsed.items)) {
        return { version: 1, items: [] };
      }
      return { version: 1, items: parsed.items };
    } catch (err) {
      if (isNotFound(err)) {
        return { version: 1, items: [] };
      }
      throw err;
    }
  }

  async save(userId: string, file: NotificationInboxFile): Promise<void> {
    const trimmed: NotificationInboxFile = {
      version: 1,
      items: file.items.slice(0, MAX_ITEMS),
    };
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: this.key(userId),
        Body: JSON.stringify(trimmed),
        ContentType: "application/json",
      })
    );
  }

  /** Last-write-wins por `syncVersion`, desempate por `updatedAt` ISO. */
  static mergeRecord(a: NotificationRecord, b: NotificationRecord): NotificationRecord {
    if (b.syncVersion !== a.syncVersion) {
      return b.syncVersion > a.syncVersion ? b : a;
    }
    return b.updatedAt > a.updatedAt ? b : a;
  }

  static mergeAll(existing: NotificationRecord[], incoming: NotificationRecord[]): NotificationRecord[] {
    const map = new Map<string, NotificationRecord>();
    for (const x of existing) {
      map.set(x.id, x);
    }
    for (const y of incoming) {
      const prev = map.get(y.id);
      map.set(y.id, prev ? S3NotificationStore.mergeRecord(prev, y) : y);
    }
    const merged = [...map.values()];
    merged.sort((p, q) => (q.updatedAt > p.updatedAt ? 1 : q.updatedAt < p.updatedAt ? -1 : 0));
    return merged.slice(0, MAX_ITEMS);
  }
}
