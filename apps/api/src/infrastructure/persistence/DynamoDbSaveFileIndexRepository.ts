import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  BatchGetCommand,
  BatchWriteCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { GameSave } from "@domain/entities/GameSave";
import type { SaveFileIndexMutation, SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";

const BATCH_GET_SIZE = 100;
const BATCH_WRITE_SIZE = 25;
const BATCH_MAX_ATTEMPTS = 6;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Indice de archivos en DynamoDB para reemplazar listados masivos de S3.
 */
export class DynamoDbSaveFileIndexRepository implements SaveFileIndexRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    client: DynamoDBClient,
    private readonly tableName: string
  ) {
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async listByUser(userId: string): Promise<GameSave[]> {
    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const res = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "userId = :u",
          ProjectionExpression: "userId, #k, gameId, #s, #lm",
          ExpressionAttributeNames: {
            "#k": "objectKey",
            "#s": "size",
            "#lm": "lastModified",
          },
          ExpressionAttributeValues: {
            ":u": userId,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (res.Items) items.push(...res.Items);
      lastEvaluatedKey = res.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items.map((item) => this.mapItemToGameSave(userId, item)).filter((item): item is GameSave => item !== null);
  }

  async listByUserAndGame(userId: string, gameId: string): Promise<GameSave[]> {
    const prefix = `${userId}/${gameId}/`;
    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const res = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "userId = :u AND begins_with(#k, :prefix)",
          ConsistentRead: true,
          ProjectionExpression: "userId, #k, gameId, #s, #lm",
          ExpressionAttributeNames: {
            "#k": "objectKey",
            "#s": "size",
            "#lm": "lastModified",
          },
          ExpressionAttributeValues: {
            ":u": userId,
            ":prefix": prefix,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );

      if (res.Items) items.push(...res.Items);
      lastEvaluatedKey = res.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items
      .map((item) => this.mapItemToGameSave(userId, item, gameId))
      .filter((item): item is GameSave => item !== null);
  }

  async getByObjectKey(userId: string, objectKey: string): Promise<GameSave | null> {
    const res = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: {
          userId,
          objectKey,
        },
        ProjectionExpression: "userId, #k, gameId, #s, #lm",
        ExpressionAttributeNames: {
          "#k": "objectKey",
          "#s": "size",
          "#lm": "lastModified",
        },
      })
    );

    if (!res.Item || typeof res.Item !== "object") return null;
    return this.mapItemToGameSave(userId, res.Item as Record<string, unknown>);
  }

  async batchGetByObjectKeys(userId: string, objectKeys: string[]): Promise<Map<string, GameSave>> {
    const savesByKey = new Map<string, GameSave>();
    const uniqueKeys = Array.from(new Set(objectKeys));

    for (let offset = 0; offset < uniqueKeys.length; offset += BATCH_GET_SIZE) {
      let pendingKeys = uniqueKeys.slice(offset, offset + BATCH_GET_SIZE);

      for (let attempt = 0; pendingKeys.length > 0 && attempt < BATCH_MAX_ATTEMPTS; attempt++) {
        const result = await this.docClient.send(
          new BatchGetCommand({
            RequestItems: {
              [this.tableName]: {
                Keys: pendingKeys.map((objectKey) => ({ userId, objectKey })),
                ConsistentRead: true,
                ProjectionExpression: "userId, #k, gameId, #s, #lm",
                ExpressionAttributeNames: {
                  "#k": "objectKey",
                  "#s": "size",
                  "#lm": "lastModified",
                },
              },
            },
          })
        );

        for (const item of result.Responses?.[this.tableName] ?? []) {
          const save = this.mapItemToGameSave(userId, item as Record<string, unknown>);
          if (save) savesByKey.set(save.key, save);
        }

        pendingKeys = (result.UnprocessedKeys?.[this.tableName]?.Keys ?? [])
          .map((key) => key.objectKey)
          .filter((key): key is string => typeof key === "string");

        if (pendingKeys.length > 0 && attempt + 1 < BATCH_MAX_ATTEMPTS) {
          await wait(Math.min(1_000, 50 * 2 ** attempt) + Math.random() * 50);
        }
      }

      if (pendingKeys.length > 0) {
        throw new Error(
          `DynamoDB dejó ${pendingKeys.length} claves sin leer después de ${BATCH_MAX_ATTEMPTS} intentos`
        );
      }
    }

    return savesByKey;
  }

  async batchApplyMutations(mutations: SaveFileIndexMutation[]): Promise<void> {
    for (let offset = 0; offset < mutations.length; offset += BATCH_WRITE_SIZE) {
      const chunk = mutations.slice(offset, offset + BATCH_WRITE_SIZE);
      let pendingRequests = chunk.map((mutation) =>
        mutation.type === "put"
          ? {
              PutRequest: {
                Item: {
                  userId: mutation.userId,
                  gameId: mutation.gameId,
                  objectKey: mutation.objectKey,
                  size: mutation.size,
                  lastModified: mutation.lastModified?.toISOString() ?? null,
                },
              },
            }
          : {
              DeleteRequest: {
                Key: { userId: mutation.userId, objectKey: mutation.objectKey },
              },
            }
      );

      for (let attempt = 0; pendingRequests.length > 0 && attempt < BATCH_MAX_ATTEMPTS; attempt++) {
        const result = await this.docClient.send(
          new BatchWriteCommand({
            RequestItems: { [this.tableName]: pendingRequests },
          })
        );
        pendingRequests = (result.UnprocessedItems?.[this.tableName] ?? []) as typeof pendingRequests;

        if (pendingRequests.length > 0 && attempt + 1 < BATCH_MAX_ATTEMPTS) {
          await wait(Math.min(1_000, 50 * 2 ** attempt) + Math.random() * 50);
        }
      }

      if (pendingRequests.length > 0) {
        throw new Error(
          `DynamoDB no procesó ${pendingRequests.length} cambios del índice después de ${BATCH_MAX_ATTEMPTS} intentos`
        );
      }
    }
  }

  async upsert(input: {
    userId: string;
    gameId: string;
    objectKey: string;
    size?: number;
    lastModified?: Date;
  }): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          userId: input.userId,
          objectKey: input.objectKey,
          gameId: input.gameId,
          size: input.size,
          lastModified: input.lastModified?.toISOString() ?? null,
        },
      })
    );
  }

  async delete(userId: string, objectKey: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: {
          userId,
          objectKey,
        },
      })
    );
  }

  private mapItemToGameSave(userId: string, item: Record<string, unknown>, knownGameId?: string): GameSave | null {
    const key = typeof item.objectKey === "string" ? item.objectKey : "";
    if (!key) return null;

    const keyParts = key.split("/");
    const parsedGameId = keyParts.length >= 2 ? keyParts[1] : "";
    const gameId = knownGameId ?? (typeof item.gameId === "string" ? item.gameId : parsedGameId);
    if (!gameId) return null;

    const prefix = `${userId}/${gameId}/`;
    const filename = key.startsWith(prefix) ? key.slice(prefix.length) : key;

    let lastModified = new Date(0);
    if (typeof item.lastModified === "string" && item.lastModified) {
      const parsed = new Date(item.lastModified);
      if (!Number.isNaN(parsed.getTime())) {
        lastModified = parsed;
      }
    }

    return {
      gameId,
      key,
      filename,
      lastModified,
      size: typeof item.size === "number" ? item.size : undefined,
    };
  }
}
