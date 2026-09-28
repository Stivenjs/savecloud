import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { GameStat } from "@domain/entities/GameStat";
import type { GameStatRepository } from "@domain/ports/GameStatRepository";

/**
 * Adaptador de infraestructura: Implementación DynamoDB para estadísticas de juegos.
 * En modo On-Demand (PAY_PER_REQUEST), esta tabla escala automáticamente y no cuesta si no se usa.
 */
export class DynamoDbGameStatRepository implements GameStatRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    client: DynamoDBClient,
    private readonly tableName: string
  ) {
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  async listByUser(userId: string): Promise<GameStat[]> {
    const items: Record<string, unknown>[] = [];
    let lastEvaluatedKey: Record<string, unknown> | undefined;
    do {
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "userId = :u",
          ProjectionExpression: "userId, gameId, fileCount, totalSizeBytes, #lm",
          ExpressionAttributeNames: {
            "#lm": "lastModified",
          },
          ExpressionAttributeValues: {
            ":u": userId,
          },
          ExclusiveStartKey: lastEvaluatedKey,
        })
      );
      items.push(...((result.Items ?? []) as Record<string, unknown>[]));
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return items.flatMap((item) => {
      if (typeof item.gameId !== "string" || !item.gameId) return [];

      const lastModified =
        typeof item.lastModified === "string" && item.lastModified ? new Date(item.lastModified) : null;

      return [
        {
          userId,
          gameId: item.gameId,
          fileCount: typeof item.fileCount === "number" ? item.fileCount : 0,
          totalSizeBytes: typeof item.totalSizeBytes === "number" ? item.totalSizeBytes : 0,
          lastModified: lastModified && !Number.isNaN(lastModified.getTime()) ? lastModified : null,
        },
      ];
    });
  }

  async save(stat: GameStat): Promise<void> {
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          userId: stat.userId,
          gameId: stat.gameId,
          fileCount: stat.fileCount,
          totalSizeBytes: stat.totalSizeBytes,
          lastModified: stat.lastModified ? stat.lastModified.toISOString() : null,
        },
      })
    );
  }

  async delete(userId: string, gameId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { userId, gameId },
      })
    );
  }

  async applyDelta(input: {
    userId: string;
    gameId: string;
    deltaFileCount: number;
    deltaSizeBytes: number;
    lastModified?: Date | null;
  }): Promise<void> {
    const { userId, gameId, deltaFileCount, deltaSizeBytes, lastModified } = input;

    if (deltaFileCount === 0 && deltaSizeBytes === 0 && !lastModified) {
      return;
    }

    let updateExpression = "ADD fileCount :df, totalSizeBytes :ds";
    const expressionAttributeValues: Record<string, any> = {
      ":df": deltaFileCount,
      ":ds": deltaSizeBytes,
    };

    if (lastModified !== undefined) {
      updateExpression = "SET #lm = :lm ADD fileCount :df, totalSizeBytes :ds";
      expressionAttributeValues[":lm"] = lastModified ? lastModified.toISOString() : null;
    }

    const updateInput = {
      TableName: this.tableName,
      Key: { userId, gameId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW" as const,
      ...(lastModified !== undefined
        ? {
            ExpressionAttributeNames: {
              "#lm": "lastModified",
            },
          }
        : {}),
    };

    const result = await this.docClient.send(new UpdateCommand(updateInput));

    const nextFileCount = typeof result.Attributes?.fileCount === "number" ? result.Attributes.fileCount : 0;
    const nextTotalSize = typeof result.Attributes?.totalSizeBytes === "number" ? result.Attributes.totalSizeBytes : 0;

    if (nextFileCount <= 0 || nextTotalSize < 0) {
      try {
        await this.docClient.send(
          new DeleteCommand({
            TableName: this.tableName,
            Key: { userId, gameId },
            ConditionExpression: "fileCount <= :zero AND totalSizeBytes <= :zero",
            ExpressionAttributeValues: { ":zero": 0 },
          })
        );
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "ConditionalCheckFailedException") throw error;
      }
    }
  }
}
