import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { GameSave } from "@domain/entities/GameSave";
import type { SaveFileIndexRepository } from "@domain/ports/SaveFileIndexRepository";

/**
 * Indice de archivos en DynamoDB para reemplazar listados masivos de S3.
 */
export class DynamoDbSaveFileIndexRepository implements SaveFileIndexRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    client: DynamoDBClient,
    private readonly tableName: string
  ) {
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  async listByUser(userId: string): Promise<GameSave[]> {
    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;

    do {
      const res = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "userId = :u",
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
          ExpressionAttributeNames: {
            "#k": "objectKey",
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
      })
    );

    if (!res.Item || typeof res.Item !== "object") return null;
    return this.mapItemToGameSave(userId, res.Item as Record<string, unknown>);
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
