import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { ConnectionRepository } from "@domain/ports/ConnectionRepository";

/**
 * @class DynamoDbConnectionRepository
 * @implements {ConnectionRepository}
 */
export class DynamoDbConnectionRepository implements ConnectionRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    client: DynamoDBClient,
    private readonly tableName: string
  ) {
    this.docClient = DynamoDBDocumentClient.from(client);
  }

  async saveConnection(connectionId: string, userId: string, ttl: number): Promise<void> {
    const now = Date.now();
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          connectionId,
          userId,
          ttl,
          lastActivityAt: now,
          activityGameId: null,
          activityGameName: null,
        },
      })
    );
  }

  async deleteConnection(connectionId: string): Promise<void> {
    await this.docClient.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { connectionId },
      })
    );
  }

  async getConnectionsByUser(userId: string): Promise<string[]> {
    const response = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "UserIdIndex",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
      })
    );
    return (response.Items || []).map((item) => item.connectionId);
  }

  async getConnectionPresenceByUser(userId: string): Promise<
    Array<{
      connectionId: string;
      lastActivityAt: number | null;
      activityGameId: string | null;
      activityGameName: string | null;
    }>
  > {
    const response = await this.docClient.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "UserIdIndex",
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: { ":userId": userId },
        ProjectionExpression: "connectionId, lastActivityAt, activityGameId, activityGameName",
      })
    );

    return (response.Items || []).map((item) => ({
      connectionId: item.connectionId,
      lastActivityAt: typeof item.lastActivityAt === "number" ? item.lastActivityAt : null,
      activityGameId: typeof item.activityGameId === "string" ? item.activityGameId : null,
      activityGameName: typeof item.activityGameName === "string" ? item.activityGameName : null,
    }));
  }

  /** Lookup inverso: dado un connectionId, devuelve el userId verificado guardado en $connect. */
  async getUserByConnection(connectionId: string): Promise<string | null> {
    const response = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { connectionId },
        ProjectionExpression: "userId",
      })
    );
    return (response.Item?.userId as string) ?? null;
  }

  async setConnectionActivity(
    connectionId: string,
    input: {
      lastActivityAt: number;
      activityGameId?: string | null;
      activityGameName?: string | null;
    }
  ): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { connectionId },
        UpdateExpression:
          "SET lastActivityAt = :lastActivityAt, activityGameId = :activityGameId, activityGameName = :activityGameName",
        ExpressionAttributeValues: {
          ":lastActivityAt": input.lastActivityAt,
          ":activityGameId": input.activityGameId ?? null,
          ":activityGameName": input.activityGameName ?? null,
        },
      })
    );
  }
}
