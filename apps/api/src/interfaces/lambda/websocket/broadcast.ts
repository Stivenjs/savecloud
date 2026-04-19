import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";
import { ApiGatewayNotifier } from "@infrastructure/websocket/ApiGatewayNotifier";
import { S3CloudInviteRepository } from "@infrastructure/persistence/S3CloudInviteRepository";
import { BroadcastActivityUseCase } from "@application/use-cases/BroadcastActivityUseCase";
import { normalizeGameDisplayName } from "@shared/utils";

const dynamoClient = new DynamoDBClient();
const s3Client = new S3Client();

const connectionRepo = new DynamoDbConnectionRepository(dynamoClient, process.env.CONNECTIONS_TABLE || "");
const inviteRepo = new S3CloudInviteRepository(s3Client, process.env.BUCKET_NAME || "");

export const handler = async (event: APIGatewayProxyWebsocketEventV2) => {
  const connectionId = event.requestContext.connectionId;

  const verifiedUserId = await connectionRepo.getUserByConnection(connectionId);

  if (!verifiedUserId) {
    console.warn("[ws:broadcast] REJECTED — connectionId sin userId verificado", { connectionId });
    return { statusCode: 403, body: "Forbidden" };
  }

  console.info("[ws:broadcast] Authorized request", { connectionId, userId: verifiedUserId });

  const body = JSON.parse(event.body || "{}");
  const parsedGameId = typeof body.gameId === "string" ? body.gameId.trim() : "";
  const parsedGameName = typeof body.gameName === "string" ? body.gameName.trim() : "";
  const normalizedGameName = normalizeGameDisplayName(parsedGameId, parsedGameName);
  const statusRaw = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
  const isStopSignal = parsedGameId.length === 0 || statusRaw === "online" || statusRaw === "idle";
  const wsEndpoint =
    process.env.WS_ENDPOINT || `https://${event.requestContext.domainName}/${event.requestContext.stage}`;

  const notifier = new ApiGatewayNotifier(wsEndpoint, connectionRepo);
  const broadcastUseCase = new BroadcastActivityUseCase(inviteRepo, connectionRepo, notifier);

  try {
    // Body esperado desde la app Tauri (Rust):
    // { "action": "broadcast", "userId": "xooty", "gameId": "resident-evil-4", "gameName": "Resident Evil 4" }
    await broadcastUseCase.execute({
      broadcasterUserId: verifiedUserId,
      presenceStatus: isStopSignal ? "online" : "playing",
      gameId: isStopSignal ? undefined : parsedGameId,
      gameName: isStopSignal ? undefined : normalizedGameName || parsedGameId,
    });

    await connectionRepo.setConnectionActivity(connectionId, {
      lastActivityAt: Date.now(),
      activityGameId: isStopSignal ? null : parsedGameId,
      activityGameName: isStopSignal ? null : normalizedGameName || parsedGameId,
    });

    return { statusCode: 200, body: "Broadcast sent" };
  } catch (error) {
    console.error("[ws:broadcast] Error broadcasting:", error);
    return { statusCode: 500, body: "Internal error" };
  }
};
