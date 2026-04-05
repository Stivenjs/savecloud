import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";

type APIGatewayWebsocketConnectEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;
};

const dynamoClient = new DynamoDBClient();
const connectionRepo = new DynamoDbConnectionRepository(dynamoClient, process.env.CONNECTIONS_TABLE || "");

export const handler = async (event: APIGatewayWebsocketConnectEvent) => {
  const connectionId = event.requestContext.connectionId;

  const userId = event.queryStringParameters?.userId;

  if (!userId) {
    return { statusCode: 400, body: "Missing userId in query string" };
  }

  const ttl = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  await connectionRepo.saveConnection(connectionId, userId, ttl);

  return { statusCode: 200, body: "Connected" };
};
