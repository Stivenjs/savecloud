import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "https";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";
import { verifyUserAccessToken } from "@shared/accessToken";
import { DynamoDbAccessSessionRepository } from "@infrastructure/persistence/DynamoDbAccessSessionRepository";
import { safeCompareSecret } from "@shared/safeCompare";

const CONNECTION_TTL_SECONDS = 24 * 60 * 60; // 24 h

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[ws:connect] Missing required env var: ${name}`);
  return value;
}

const connectionsTable = requireEnv("CONNECTIONS_TABLE");
const cloudInvitesTable = requireEnv("CLOUD_INVITES_TABLE");
const expectedApiKey = requireEnv("API_KEY");

const dynamoClient = new DynamoDBClient({
  requestHandler: new NodeHttpHandler({
    httpsAgent: new Agent({ keepAlive: true, maxSockets: 50 }),
    connectionTimeout: 300,
    socketTimeout: 3000,
  }),
});

const connectionRepo = new DynamoDbConnectionRepository(dynamoClient, connectionsTable);
const accessSessionRepository = new DynamoDbAccessSessionRepository(dynamoClient, cloudInvitesTable);

type APIGatewayWebsocketConnectEvent = APIGatewayProxyWebsocketEventV2 & {
  headers?: Record<string, string>;
};

type LambdaWebsocketResult = { statusCode: 200 | 401 | 500; body: string };

/**
 * Comparación en tiempo constante normalizada a base64.
 * Evita el bug de UTF-8 donde caracteres multi-byte producen buffers
 * de distinta longitud aunque los strings sean lógicamente iguales.
 */
/**
 * Resuelve el userId verificado desde los headers del handshake.
 *
 * - Host (dueño del cloud): x-user-id + x-api-key
 * - Invitado:               x-user-id + x-api-key (token sc2 firmado y sesión activa)
 *
 * Retorna null si las credenciales no son válidas o no coinciden con el userId declarado.
 */
function getHeader(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return "";
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1]?.trim() ?? "";
}

async function resolveVerifiedUserId(
  headers: Record<string, string> | undefined
): Promise<{ userId: string; sessionId?: string } | null> {
  if (!headers) {
    console.debug("[ws:connect] NO HEADERS — reject");
    return null;
  }

  const declaredUserId = getHeader(headers, "x-user-id");
  if (!declaredUserId) {
    console.debug("[ws:connect] NO userId — reject");
    return null;
  }

  const apiKey = getHeader(headers, "x-api-key");
  if (apiKey && safeCompareSecret(apiKey, expectedApiKey)) {
    console.info("[ws:connect] HOST AUTHORIZED", { userId: declaredUserId });
    return { userId: declaredUserId };
  }

  const authorization = getHeader(headers, "authorization");
  const token = (apiKey || authorization.match(/^Bearer\s+(.+)$/i)?.[1] || "").trim();
  if (!token) {
    console.debug("[ws:connect] NO token/apiKey — reject");
    return null;
  }

  const verified = verifyUserAccessToken(token);
  if (!verified) {
    console.warn("[ws:connect] TOKEN INVALID", { tokenLength: token.length });
    return null;
  }

  if (verified.userId !== declaredUserId) {
    console.warn("[ws:connect] TOKEN MISMATCH", {
      declared: declaredUserId,
      verified: verified.userId,
    });
    return null;
  }

  if (!verified.sessionId || !verified.hostUserId) return null;
  const session = await accessSessionRepository.get(verified.sessionId);
  if (
    !session ||
    !session.active ||
    session.userId !== verified.userId ||
    session.hostUserId !== verified.hostUserId ||
    session.expiresAtEpoch <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  console.info("[ws:connect] GUEST AUTHORIZED", { userId: declaredUserId });
  return { userId: declaredUserId, sessionId: verified.sessionId };
}

export const handler = async (event: APIGatewayWebsocketConnectEvent): Promise<LambdaWebsocketResult> => {
  const connectionId = event.requestContext.connectionId;
  const identity = await resolveVerifiedUserId(event.headers);

  if (!identity) {
    console.warn("[ws:connect] REJECTED", {
      connectionId,
      headerNames: Object.keys(event.headers ?? {}).map((key) => key.toLowerCase()),
    });
    return { statusCode: 401, body: "Unauthorized" };
  }

  const deviceId = getHeader(event.headers, "x-device-id");
  const ttl = Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;
  try {
    await connectionRepo.saveConnection(connectionId, identity.userId, ttl, deviceId);
    console.info("[ws:connect] Connection saved", { connectionId, userId: identity.userId, deviceId });
  } catch (error) {
    console.error("[ws:connect] Failed to save connection", { connectionId, error });
    return { statusCode: 500, body: "Internal Server Error" };
  }

  return { statusCode: 200, body: "Connected" };
};
