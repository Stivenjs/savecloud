import type { APIGatewayProxyWebsocketEventV2 } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDbConnectionRepository } from "@infrastructure/persistence/DynamoDbConnectionRepository";
import { verifyUserAccessToken } from "@shared/accessToken";
import { timingSafeEqual } from "crypto";

type APIGatewayWebsocketConnectEvent = APIGatewayProxyWebsocketEventV2 & {
  queryStringParameters?: Record<string, string>;
  headers?: Record<string, string>;
};

const dynamoClient = new DynamoDBClient();
const connectionRepo = new DynamoDbConnectionRepository(dynamoClient, process.env.CONNECTIONS_TABLE || "");

const expectedApiKey = process.env.API_KEY ?? "";

function safeCompare(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
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

  const declaredUserId = (params.userId ?? "").trim();
  if (!declaredUserId) {
    console.debug("[ws:connect] NO userId — reject", { params: Object.keys(params) });
    return null;
  }

  // Modo host: valida contra el API key global del entorno
  const apiKey = (params.apiKey ?? "").trim();
  if (apiKey && expectedApiKey && safeCompare(apiKey, expectedApiKey)) {
    console.info("[ws:connect] HOST AUTHORIZED", { userId: declaredUserId });
    return declaredUserId;
  }

  // Modo invitado: valida access token HMAC emitido al aceptar la invitación
  // Probamos con "token" y "accessToken" por robustez ante variaciones del cliente
  const token = (params.token || params.accessToken || "").trim();
  if (token) {
    const verified = verifyUserAccessToken(token);
    if (verified) {
      if (verified.userId === declaredUserId) {
        console.info("[ws:connect] GUEST AUTHORIZED", { userId: declaredUserId });
        return declaredUserId;
      } else {
        console.warn("[ws:connect] TOKEN MISMATCH — token sub does not match declared userId", {
          declared: declaredUserId,
          verified: verified.userId,
        });
      }
    } else {
      console.warn("[ws:connect] TOKEN INVALID — verifyUserAccessToken failed (check secret/exp)", {
        tokenPrefix: token.substring(0, 8),
      });
    }
  } else {
    console.debug("[ws:connect] NO token/apiKey — reject");
  }

  return null;
}

export const handler = async (event: APIGatewayWebsocketConnectEvent) => {
  const connectionId = event.requestContext.connectionId;
  const verifiedUserId = resolveVerifiedUserId(event.queryStringParameters);

  if (!verifiedUserId) {
    console.warn("[ws:connect] REJECTED — credenciales inválidas o ausentes", {
      connectionId,
      params: Object.keys(event.queryStringParameters ?? {}),
    });
    return { statusCode: 401, body: "Unauthorized" };
  }

  const ttl = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  try {
    await connectionRepo.saveConnection(connectionId, verifiedUserId, ttl);
    console.info("[ws:connect] Connection saved to DynamoDB", { connectionId, userId: verifiedUserId });
  } catch (error) {
    console.error("[ws:connect] FATAL: Error saving connection to DynamoDB", error);
    return { statusCode: 500, body: "Internal Server Error" };
  }

  return { statusCode: 200, body: "Connected" };
};
