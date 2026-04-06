import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";

const dynamoClient = new DynamoDBClient();
const connectionRepo = new DynamoDbConnectionRepository(dynamoClient, process.env.CONNECTIONS_TABLE || "");

export const handler = async (event: APIGatewayProxyWebsocketEventV2) => {
  await connectionRepo.deleteConnection(event.requestContext.connectionId);
  return { statusCode: 200, body: "Disconnected" };
};
