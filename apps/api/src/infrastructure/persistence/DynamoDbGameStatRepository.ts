import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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
    const result = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "userId = :u",
        ExpressionAttributeValues: {
          ":u": userId,
        },
      })
    );

    if (!result.Items) return [];

    return result.Items.map((item) => ({
      userId: item.userId,
      gameId: item.gameId,
      fileCount: item.fileCount ?? 0,
      totalSizeBytes: item.totalSizeBytes ?? 0,
      lastModified: item.lastModified ? new Date(item.lastModified) : null,
    }));
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
}
