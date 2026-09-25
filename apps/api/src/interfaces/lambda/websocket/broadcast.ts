import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "https";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";
import { ApiGatewayNotifier } from "@infrastructure/websocket/ApiGatewayNotifier";
import { S3CloudInviteRepository } from "@infrastructure/persistence/S3CloudInviteRepository";
import { BroadcastActivityUseCase } from "@application/use-cases/BroadcastActivityUseCase";
import { RelayStreamSignalUseCase } from "@application/use-cases/RelayStreamSignalUseCase";
import { normalizeGameDisplayName } from "@shared/utils";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[ws:broadcast] Missing required env var: ${name}`);
  return value;
}

const connectionsTable = requireEnv("CONNECTIONS_TABLE");
const bucketName = requireEnv("BUCKET_NAME");

const requestHandler = (maxSockets: number) =>
  new NodeHttpHandler({
    httpsAgent: new Agent({ keepAlive: true, maxSockets }),
    connectionTimeout: 300,
    socketTimeout: 3000,
  });

const dynamoClient = new DynamoDBClient({ requestHandler: requestHandler(50) });
const s3Client = new S3Client({ requestHandler: requestHandler(50) });

const connectionRepo = new DynamoDbConnectionRepository(dynamoClient, connectionsTable);
const inviteRepo = new S3CloudInviteRepository(s3Client, bucketName);

let notifier: ApiGatewayNotifier | null = null;

function getNotifier(event: APIGatewayProxyWebsocketEventV2): ApiGatewayNotifier {
  if (!notifier) {
    const wsEndpoint =
      process.env.WS_ENDPOINT?.trim() || `https://${event.requestContext.domainName}/${event.requestContext.stage}`;
    notifier = new ApiGatewayNotifier(wsEndpoint, connectionRepo);
  }
  return notifier;
}

type LambdaWebsocketResult = { statusCode: 200 | 400 | 403 | 500; body: string };

export const handler = async (event: APIGatewayProxyWebsocketEventV2): Promise<LambdaWebsocketResult> => {
  const connectionId = event.requestContext.connectionId;

  const verifiedUserId = await connectionRepo.getUserByConnection(connectionId);
  if (!verifiedUserId) {
    console.warn("[ws:broadcast] REJECTED — connectionId sin userId verificado", { connectionId });
    return { statusCode: 403, body: "Forbidden" };
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    console.warn("[ws:broadcast] Malformed JSON body", { connectionId });
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const messageType = typeof body.type === "string" ? body.type.trim().toUpperCase() : "";
  const ws = getNotifier(event);

  if (messageType === "STREAM_SIGNAL") {
    const streamSignalUseCase = new RelayStreamSignalUseCase(inviteRepo, connectionRepo, ws);
    try {
      await streamSignalUseCase.execute({
        senderUserId: verifiedUserId,
        event: typeof body.event === "string" ? body.event.trim() : "",
        streamId: typeof body.streamId === "string" ? body.streamId.trim() : "",
        targetUserId: typeof body.targetUserId === "string" ? body.targetUserId.trim() : undefined,
        payload: body.payload ?? null,
      });
      return { statusCode: 200, body: "Signal relayed" };
    } catch (error) {
      console.error("[ws:broadcast] Error relaying stream signal", { connectionId, error });
      return { statusCode: 400, body: "Invalid stream signal" };
    }
  }

  const parsedGameId = typeof body.gameId === "string" ? body.gameId.trim() : "";
  const parsedGameName = typeof body.gameName === "string" ? body.gameName.trim() : "";
  const normalizedGameName = normalizeGameDisplayName(parsedGameId, parsedGameName);

  const isStopSignal = parsedGameId.length === 0;

  try {
    await connectionRepo.setConnectionActivity(connectionId, {
      lastActivityAt: Date.now(),
      activityGameId: isStopSignal ? null : parsedGameId,
      activityGameName: isStopSignal ? null : normalizedGameName || parsedGameId,
    });
  } catch (error) {
    console.error("[ws:broadcast] Error actualizando actividad en DynamoDB", { connectionId, error });
  }

  const broadcastUseCase = new BroadcastActivityUseCase(inviteRepo, connectionRepo, ws);
  try {
    await broadcastUseCase.execute({
      broadcasterUserId: verifiedUserId,
      presenceStatus: isStopSignal ? "online" : "playing",
      gameId: isStopSignal ? undefined : parsedGameId,
      gameName: isStopSignal ? undefined : normalizedGameName || parsedGameId,
    });
    return { statusCode: 200, body: "Broadcast sent" };
  } catch (error) {
    console.error("[ws:broadcast] Error broadcasting", { connectionId, error });
    return { statusCode: 500, body: "Internal error" };
  }
};
