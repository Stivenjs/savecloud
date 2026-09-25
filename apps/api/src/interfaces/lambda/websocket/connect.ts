import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "https";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";
import { verifyUserAccessToken } from "@shared/accessToken";
import { timingSafeEqual } from "crypto";

const CONNECTION_TTL_SECONDS = 24 * 60 * 60; // 24 h

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[ws:connect] Missing required env var: ${name}`);
  return value;
}

const connectionsTable = requireEnv("CONNECTIONS_TABLE");
const expectedApiKey = process.env.API_KEY?.trim() ?? "";

const dynamoClient = new DynamoDBClient({
  requestHandler: new NodeHttpHandler({
    httpsAgent: new Agent({ keepAlive: true, maxSockets: 50 }),
    connectionTimeout: 300,
    socketTimeout: 3000,
  }),
});

const connectionRepo = new DynamoDbConnectionRepository(dynamoClient, connectionsTable);

type APIGatewayWebsocketConnectEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;
};

type LambdaWebsocketResult = { statusCode: 200 | 401 | 500; body: string };

/**
 * Comparación en tiempo constante normalizada a base64.
 * Evita el bug de UTF-8 donde caracteres multi-byte producen buffers
 * de distinta longitud aunque los strings sean lógicamente iguales.
 */
function safeCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a, "base64");
  const bb = Buffer.from(b, "base64");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Resuelve el userId verificado desde las credenciales de la query string.
 *
 * - Host (dueño del cloud): ?userId=X&apiKey=<global_api_key>
 * - Invitado:               ?userId=X&token=sc1.<payload>.<sig>
 *
 * Retorna null si las credenciales no son válidas o no coinciden con el userId declarado.
 */
function resolveVerifiedUserId(params: Record<string, string> | undefined): string | null {
  if (!params) {
    console.debug("[ws:connect] NO PARAMS — reject");
    return null;
  }

  const declaredUserId = params.userId?.trim() ?? "";
  if (!declaredUserId) {
    console.debug("[ws:connect] NO userId — reject");
    return null;
  }

  const apiKey = params.apiKey?.trim() ?? "";
  if (apiKey && expectedApiKey && safeCompare(apiKey, expectedApiKey)) {
    console.info("[ws:connect] HOST AUTHORIZED", { userId: declaredUserId });
    return declaredUserId;
  }

  const token = (params.token ?? params.accessToken ?? "").trim();
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

  console.info("[ws:connect] GUEST AUTHORIZED", { userId: declaredUserId });
  return declaredUserId;
}

export const handler = async (event: APIGatewayWebsocketConnectEvent): Promise<LambdaWebsocketResult> => {
  const connectionId = event.requestContext.connectionId;
  const verifiedUserId = resolveVerifiedUserId(event.queryStringParameters);

  if (!verifiedUserId) {
    console.warn("[ws:connect] REJECTED", {
      connectionId,
      paramKeys: Object.keys(event.queryStringParameters ?? {}),
    });
    return { statusCode: 401, body: "Unauthorized" };
  }

  const deviceId = event.queryStringParameters?.deviceId?.trim();
  const ttl = Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;
  try {
    await connectionRepo.saveConnection(connectionId, verifiedUserId, ttl, deviceId);
    console.info("[ws:connect] Connection saved", { connectionId, userId: verifiedUserId, deviceId });
  } catch (error) {
    console.error("[ws:connect] Failed to save connection", { connectionId, error });
    return { statusCode: 500, body: "Internal Server Error" };
  }

  return { statusCode: 200, body: "Connected" };
};
