import type { SQL } from "bun";
import type { NotificationInboxFile, NotificationRecord } from "@domain/entities/NotificationRecord";
import type { ExpiredNotificationRepository } from "@domain/ports/ExpiredNotificationRepository";
import type { NotificationRepository } from "@domain/ports/NotificationRepository";

const MAX_ITEMS = 500;
const NOTIFICATION_TTL_DAYS = 30;
const UPSERT_BATCH_SIZE = 500;

/** Forma heredada de DynamoDB que incluye el atributo de TTL fuera del contrato de dominio. */
export type LegacyNotificationRecord = NotificationRecord & { expiresAtEpoch?: number };

function expirationEpoch(days = NOTIFICATION_TTL_DAYS): number {
  return Math.floor(Date.now() / 1000) + days * 86_400;
}

function asNotificationRecord(value: unknown): NotificationRecord | undefined {
  if (typeof value === "string") {
    try {
      return asNotificationRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<NotificationRecord>;
  if (typeof record.id !== "string" || typeof record.userId !== "string" || typeof record.updatedAt !== "string") {
    return undefined;
  }
  return record as NotificationRecord;
}

/** Persistencia relacional del inbox, con una sentencia parametrizada por guardado. */
export class PostgresNotificationStore implements NotificationRepository, ExpiredNotificationRepository {
  /** Crea el adaptador con el pool PostgreSQL compartido por la aplicación. */
  constructor(private readonly sql: SQL) {}

  /** Crea idempotentemente la tabla e índices necesarios para las notificaciones. */
  async ensureSchema(): Promise<void> {
    await ensurePostgresNotificationSchema(this.sql);
  }

  /** Carga las notificaciones vigentes de un usuario, ordenadas por última actualización. */
  async load(userId: string): Promise<NotificationInboxFile> {
    const cleanUserId = userId?.trim();
    if (!cleanUserId) return { version: 1, items: [] };

    const nowEpoch = Math.floor(Date.now() / 1000);
    const rows = await this.sql<{ item_json: unknown }[]>`
      SELECT item_json
      FROM savecloud_notifications
      WHERE user_id = ${cleanUserId} AND expires_at_epoch > ${nowEpoch}
      ORDER BY updated_at DESC, notification_id DESC
      LIMIT ${MAX_ITEMS}
    `;

    const items = rows
      .map((row) => asNotificationRecord(row.item_json))
      .filter((item): item is NotificationRecord => item !== undefined);

    return { version: 1, items };
  }

  /** Guarda hasta 500 notificaciones del usuario en una sentencia masiva UPSERT. */
  async save(userId: string, file: NotificationInboxFile): Promise<void> {
    const cleanUserId = userId?.trim();
    if (!cleanUserId || !Array.isArray(file?.items) || file.items.length === 0) return;

    const expiresAtEpoch = expirationEpoch();
    const rows = file.items.slice(0, MAX_ITEMS).map((item) => ({
      ...item,
      userId: cleanUserId,
    }));
    await this.upsert(rows, expiresAtEpoch);
  }

  /**
   * Importa registros heredados sin extender el TTL que ya tenían en DynamoDB.
   * @param items Registros heredados procedentes de DynamoDB o del respaldo S3.
   */
  async importLegacyRecords(items: LegacyNotificationRecord[]): Promise<void> {
    if (items.length === 0) return;

    const defaultExpiration = expirationEpoch();
    const rows = items
      .filter((item) => item.userId?.trim() && item.id?.trim())
      .map(({ expiresAtEpoch, ...item }) => ({
        ...item,
        userId: item.userId.trim(),
        expiresAtEpoch:
          typeof expiresAtEpoch === "number" && Number.isSafeInteger(expiresAtEpoch) && expiresAtEpoch > 0
            ? expiresAtEpoch
            : defaultExpiration,
      }));

    for (let offset = 0; offset < rows.length; offset += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(offset, offset + UPSERT_BATCH_SIZE);
      await this.upsert(batch, defaultExpiration, true);
    }
  }

  /** Elimina un lote de notificaciones vencidas usando bloqueos que permiten varios workers. */
  async deleteExpiredBatch(limit: number): Promise<number> {
    const batchLimit = Math.max(1, Math.min(Math.floor(limit), 10_000));
    const nowEpoch = Math.floor(Date.now() / 1000);
    const deleted = await this.sql<{ notification_id: string }[]>`
      WITH expired_rows AS (
        SELECT ctid
        FROM savecloud_notifications
        WHERE expires_at_epoch <= ${nowEpoch}
        ORDER BY expires_at_epoch
        LIMIT ${batchLimit}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM savecloud_notifications AS notifications
      USING expired_rows
      WHERE notifications.ctid = expired_rows.ctid
      RETURNING notifications.notification_id
    `;
    return deleted.length;
  }

  private async upsert(
    items: Array<NotificationRecord & { expiresAtEpoch?: number }>,
    defaultExpiration: number,
    preserveExpiration = false
  ): Promise<void> {
    const uniqueItems = new Map<string, (typeof items)[number]>();
    for (const item of items) uniqueItems.set(`${item.userId}\u0000${item.id}`, item);
    const records = [...uniqueItems.values()];

    for (let offset = 0; offset < records.length; offset += UPSERT_BATCH_SIZE) {
      const batch = records.slice(offset, offset + UPSERT_BATCH_SIZE);
      const values = batch.map((item) => {
        const updatedAt = Number.isNaN(Date.parse(item.updatedAt)) ? new Date().toISOString() : item.updatedAt;
        const expiresAtEpoch = preserveExpiration ? (item.expiresAtEpoch ?? defaultExpiration) : defaultExpiration;

        return {
          user_id: item.userId,
          notification_id: item.id,
          updated_at: updatedAt,
          expires_at_epoch: expiresAtEpoch,
          item_json: { ...item, updatedAt },
        };
      });

      await this.sql`
        INSERT INTO savecloud_notifications
        ${this.sql(values, "user_id", "notification_id", "updated_at", "expires_at_epoch", "item_json")}
        ON CONFLICT (user_id, notification_id) DO UPDATE SET
          updated_at = EXCLUDED.updated_at,
          expires_at_epoch = EXCLUDED.expires_at_epoch,
          item_json = EXCLUDED.item_json
        WHERE EXCLUDED.updated_at >= savecloud_notifications.updated_at
      `;
    }
  }
}

/** Inicializa la tabla y los índices de notificaciones sin modificar otras tablas de PostgreSQL. */
export async function ensurePostgresNotificationSchema(sql: SQL): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS savecloud_notifications (
      user_id text NOT NULL,
      notification_id text NOT NULL,
      updated_at timestamptz NOT NULL,
      expires_at_epoch bigint NOT NULL,
      item_json jsonb NOT NULL,
      PRIMARY KEY (user_id, notification_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS savecloud_notifications_user_updated_idx
    ON savecloud_notifications (user_id, updated_at DESC, notification_id DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS savecloud_notifications_expiration_idx
    ON savecloud_notifications (expires_at_epoch)
  `;
}
