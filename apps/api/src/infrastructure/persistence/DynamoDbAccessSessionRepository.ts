import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { AccessSession } from "@domain/entities/AccessSession";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";

interface AccessSessionRecord extends AccessSession {
  pk: string;
  sk: "METADATA";
  entityType: "ACCESS_SESSION";
  gsi1pk: string;
  gsi1sk: string;
}

function membershipIndexKey(hostUserId: string, userId: string): string {
  return `SESSION_MEMBER#${hostUserId}#${userId}`;
}

export class DynamoDbAccessSessionRepository implements AccessSessionRepository {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    dynamoClient: DynamoDBClient,
    private readonly tableName: string
  ) {
    this.docClient = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  async create(session: AccessSession): Promise<void> {
    const record: AccessSessionRecord = {
      ...session,
      pk: `SESSION#${session.sessionId}`,
      sk: "METADATA",
      entityType: "ACCESS_SESSION",
      gsi1pk: membershipIndexKey(session.hostUserId, session.userId),
      gsi1sk: `SESSION#${session.sessionId}`,
    };
    await this.docClient.send(
      new PutCommand({
        TableName: this.tableName,
        Item: record,
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );
  }

  async get(sessionId: string): Promise<AccessSession | null> {
    const result = await this.docClient.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `SESSION#${sessionId}`, sk: "METADATA" },
        ConsistentRead: true,
      })
    );
    const record = result.Item as AccessSessionRecord | undefined;
    if (!record || record.entityType !== "ACCESS_SESSION") return null;
    return {
      sessionId: record.sessionId,
      userId: record.userId,
      hostUserId: record.hostUserId,
      refreshTokenHash: record.refreshTokenHash,
      active: record.active,
      createdAt: record.createdAt,
      expiresAtEpoch: record.expiresAtEpoch,
    };
  }

  async rotateRefreshToken(
    sessionId: string,
    expectedTokenHash: string,
    nextTokenHash: string,
    expiresAtEpoch: number
  ): Promise<boolean> {
    try {
      await this.docClient.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `SESSION#${sessionId}`, sk: "METADATA" },
          UpdateExpression: "SET refreshTokenHash = :nextHash, expiresAtEpoch = :expires",
          ConditionExpression:
            "entityType = :entityType AND active = :active AND refreshTokenHash = :expectedHash AND expiresAtEpoch > :now",
          ExpressionAttributeValues: {
            ":entityType": "ACCESS_SESSION",
            ":active": true,
            ":expectedHash": expectedTokenHash,
            ":nextHash": nextTokenHash,
            ":expires": expiresAtEpoch,
            ":now": Math.floor(Date.now() / 1000),
          },
        })
      );
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }

  async revoke(sessionId: string): Promise<void> {
    await this.docClient.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk: `SESSION#${sessionId}`, sk: "METADATA" },
        UpdateExpression: "SET active = :inactive",
        ConditionExpression: "entityType = :entityType",
        ExpressionAttributeValues: { ":entityType": "ACCESS_SESSION", ":inactive": false },
      })
    );
  }

  async revokeMembershipSessions(hostUserId: string, userId: string): Promise<void> {
    let exclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const page = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: "GSI1",
          KeyConditionExpression: "gsi1pk = :membershipKey",
          ExpressionAttributeValues: { ":membershipKey": membershipIndexKey(hostUserId, userId) },
          ExclusiveStartKey: exclusiveStartKey,
        })
      );
      for (const item of page.Items ?? []) {
        const record = item as AccessSessionRecord;
        if (record.entityType === "ACCESS_SESSION" && record.active) await this.revoke(record.sessionId);
      }
      exclusiveStartKey = page.LastEvaluatedKey;
    } while (exclusiveStartKey);
  }
}
