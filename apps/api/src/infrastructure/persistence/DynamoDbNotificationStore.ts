import { GetObjectCommand, NoSuchKey, S3Client } from "@aws-sdk/client-s3";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, QueryCommand, BatchWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { NotificationInboxFile, NotificationRecord } from "@domain/entities/NotificationRecord";
import type { NotificationRepository } from "@domain/ports/NotificationRepository";

const MAX_ITEMS = 500;
const NOTIFICATION_TTL_DAYS = 30;
const BATCH_WRITE_MAX_ATTEMPTS = 6;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function calculateTtlEpoch(days = NOTIFICATION_TTL_DAYS): number {
  return Math.floor(Date.now() / 1000) + days * 86400;
}

export class DynamoDbNotificationStore implements NotificationRepository {
  private readonly dynamoClient: DynamoDBClient;
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly s3?: S3Client;
  private readonly bucketName?: string;

  constructor(dynamoClient: DynamoDBClient, tableName: string, s3?: S3Client, bucketName?: string) {
    this.dynamoClient = dynamoClient;
    this.tableName = tableName;
    this.s3 = s3;
    this.bucketName = bucketName;
    this.docClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  private s3Key(userId: string): string {
    return `notifications/${userId}/notifications.json`;
  }

  /**
   * Carga las notificaciones del usuario desde DynamoDB con ordenación temporal.
   * Si no existen registros en DynamoDB, realiza lazy-migration transparente desde S3.
   */
  async load(userId: string): Promise<NotificationInboxFile> {
    if (!userId?.trim()) return { version: 1, items: [] };

    try {
      const items: NotificationRecord[] = [];
      let lastEvaluatedKey: Record<string, unknown> | undefined;
      do {
        const res = await this.docClient.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: "userId = :userId",
            ExpressionAttributeValues: {
              ":userId": userId.trim(),
            },
            ExclusiveStartKey: lastEvaluatedKey,
          })
        );
        items.push(...((res.Items ?? []) as NotificationRecord[]));
        lastEvaluatedKey = res.LastEvaluatedKey;
      } while (lastEvaluatedKey);

      if (items.length > 0) {
        items.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : b.updatedAt < a.updatedAt ? -1 : 0));
        return { version: 1, items: items.slice(0, MAX_ITEMS) };
      }

      // Fallback a S3 para migración transparente de inboxes existentes
      if (this.s3 && this.bucketName) {
        const s3Items = await this.loadFromS3Fallback(userId.trim());
        if (s3Items.length > 0) {
          // Migrar en segundo plano a DynamoDB
          this.saveBatch(userId.trim(), s3Items).catch((err) =>
            console.warn("[DynamoDbNotificationStore] Fallo al migrar notificaciones desde S3:", err)
          );
          return { version: 1, items: s3Items.slice(0, MAX_ITEMS) };
        }
      }

      return { version: 1, items: [] };
    } catch (err) {
      console.error("[DynamoDbNotificationStore] Error al cargar notificaciones", { userId, err });
      return { version: 1, items: [] };
    }
  }

  /**
   * Guarda o actualiza un inbox completo (compatible con la interfaz previa).
   */
  async save(userId: string, file: NotificationInboxFile): Promise<void> {
    if (!userId?.trim() || !file?.items) return;
    await this.saveBatch(userId.trim(), file.items);
  }

  /**
   * Guarda un lote de notificaciones en DynamoDB calculando el TTL de auto-expiración.
   */
  async saveBatch(userId: string, items: NotificationRecord[]): Promise<void> {
    if (!userId?.trim() || items.length === 0) return;

    const ttlEpoch = calculateTtlEpoch();
    const cleanUserId = userId.trim();

    // Dividir en bloques de 25 (límite de BatchWriteItem de DynamoDB)
    const chunks: NotificationRecord[][] = [];
    for (let i = 0; i < items.length; i += 25) {
      chunks.push(items.slice(i, i + 25));
    }

    for (const chunk of chunks) {
      const putRequests = chunk.map((item) => ({
        PutRequest: {
          Item: {
            ...item,
            userId: cleanUserId,
            expiresAtEpoch: ttlEpoch,
          },
        },
      }));

      let pendingRequests = putRequests;
      for (let attempt = 0; pendingRequests.length > 0 && attempt < BATCH_WRITE_MAX_ATTEMPTS; attempt++) {
        const result = await this.docClient.send(
          new BatchWriteCommand({
            RequestItems: {
              [this.tableName]: pendingRequests,
            },
          })
        );
        pendingRequests = (result.UnprocessedItems?.[this.tableName] ?? []) as typeof putRequests;

        if (pendingRequests.length > 0 && attempt + 1 < BATCH_WRITE_MAX_ATTEMPTS) {
          const backoffMs = Math.min(1_000, 50 * 2 ** attempt);
          await wait(backoffMs + Math.random() * 50);
        }
      }

      if (pendingRequests.length > 0) {
        throw new Error(
          `DynamoDB no procesó ${pendingRequests.length} notificaciones después de ${BATCH_WRITE_MAX_ATTEMPTS} intentos`
        );
      }
    }
  }

  private async loadFromS3Fallback(userId: string): Promise<NotificationRecord[]> {
    if (!this.s3 || !this.bucketName) return [];
    try {
      const res = await this.s3.send(
        new GetObjectCommand({
          Bucket: this.bucketName,
          Key: this.s3Key(userId),
        })
      );
      const raw = await res.Body?.transformToString();
      if (!raw?.trim()) return [];
      const parsed = JSON.parse(raw) as NotificationInboxFile;
      if (!parsed.items || !Array.isArray(parsed.items)) return [];
      return parsed.items;
    } catch (err) {
      if (err instanceof NoSuchKey) return [];
      return [];
    }
  }
}
