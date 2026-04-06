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
  if (!params) return null;

  const declaredUserId = (params.userId ?? "").trim();
  if (!declaredUserId) return null;

  // Modo host: valida contra el API key global del entorno
  const apiKey = (params.apiKey ?? "").trim();
  if (apiKey && expectedApiKey && safeCompare(apiKey, expectedApiKey)) {
    return declaredUserId;
  }

  // Modo invitado: valida access token HMAC emitido al aceptar la invitación
  const token = (params.token ?? "").trim();
  if (token) {
    const verified = verifyUserAccessToken(token);
    if (verified && verified.userId === declaredUserId) {
      return declaredUserId;
    }
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
  await connectionRepo.saveConnection(connectionId, verifiedUserId, ttl);

  return { statusCode: 200, body: "Connected" };
};
