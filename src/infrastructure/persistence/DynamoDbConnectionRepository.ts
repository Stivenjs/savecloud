import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
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
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { connectionId, userId, ttl },
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
}
