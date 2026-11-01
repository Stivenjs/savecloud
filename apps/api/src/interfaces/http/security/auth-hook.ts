import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccessSessionRepository } from "@domain/ports/AccessSessionRepository";
import { ApplicationError } from "@application/errors/ApplicationError";
import {
  authenticateRequestCredential,
  extractRequestCredential,
} from "@application/use-cases/AuthenticateRequestCredential";
import { isPublicRoute } from "@interfaces/http/security/public-routes";

declare module "fastify" {
  interface FastifyRequest {
    scAuthenticatedUserId?: string;
    scRateLimitUserId?: string;
    awsLambda?: {
      event?: {
        requestContext?: {
          http?: { sourceIp?: string };
          authorizer?: {
            lambda?: Record<string, unknown>;
          };
        };
      };
    };
  }
}

/**
 * Registra el hook global de autenticación `onRequest` de Fastify.
 *
 * Determina si la petición entrante está autorizada evaluando secuencialmente:
 * 1. Rutas públicas excluidas de autenticación (`isPublicRoute`).
 * 2. Contexto de autorización previo emitido por AWS Lambda Authorizer en API Gateway.
 * 3. API Key maestra del servidor (`x-api-key` o `Authorization: Bearer <key>`).
 * 4. Token de sesión de usuario autenticado (`Authorization: Bearer <token>` junto a `x-user-id`).
 *
 * @param app - Instancia principal de Fastify donde se registrará el hook.
 * @param expectedApiKey - Clave API maestra esperada (`process.env.API_KEY`).
 * @param accessSessionRepository - Repositorio para la consulta y validación del ciclo de vida de sesiones activas.
 */
export function registerApiKeyAuthHook(
  app: FastifyInstance,
  expectedApiKey?: string,
  accessSessionRepository?: AccessSessionRepository
): void {
  app.addHook("onRequest", async (request) => {
    if (isPublicRoute(request)) return;

    const handledLambda = await handleLambdaAuthorizer(request, accessSessionRepository);
    if (handledLambda) return;

    const identity = await authenticateRequestCredential({
      credential: extractRequestCredential(
        getStringHeader(request.headers["x-api-key"]),
        getStringHeader(request.headers.authorization)
      ),
      declaredUserId: getStringHeader(request.headers["x-user-id"]),
      expectedApiKey,
      accessSessionRepository,
    });
    if (identity) {
      request.scAuthenticatedUserId = identity.userId;
      request.scRateLimitUserId = identity.rateLimitUserId;
      return;
    }

    throw new ApplicationError("UNAUTHENTICATED", "No autorizado.");
  });
}

/** Devuelve un encabezado HTTP solo cuando tiene un único valor de texto. */
function getStringHeader(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Procesa la información de autorización inyectada por un Lambda Authorizer en AWS API Gateway.
 *
 * Soporta dos modos de autorización:
 * - `access-token`: Verifica que la sesión del usuario exista, permanezca activa, no haya expirado
 *   y coincida exactamente con el usuario y anfitrión autorizados.
 * - `api-key`: Asocia el identificador de usuario declarado en la cabecera `x-user-id`.
 *
 * @param request - Solicitud HTTP de Fastify en curso.
 * @param accessSessionRepository - Repositorio de sesiones de acceso para validar sesiones de usuario.
 * @returns `true` si la solicitud contenía un contexto de autorizador Lambda procesado, `false` de lo contrario.
 * @throws {ApplicationError} Si el modo es `access-token` y la sesión es inválida, expiró o fue revocada.
 */
async function handleLambdaAuthorizer(
  request: FastifyRequest,
  accessSessionRepository?: AccessSessionRepository
): Promise<boolean> {
  const rawReq = request.raw as {
    apiGateway?: { event?: { requestContext?: { authorizer?: { lambda?: Record<string, unknown> } } } };
  };
  const authorizerLambda =
    rawReq.apiGateway?.event?.requestContext?.authorizer?.lambda ??
    request.awsLambda?.event?.requestContext?.authorizer?.lambda;

  if (!authorizerLambda || (!authorizerLambda.authMode && authorizerLambda.isAuthorized !== true)) {
    return false;
  }

  const authorizedUserId = authorizerLambda.userId;
  if (typeof authorizedUserId === "string" && authorizedUserId.trim()) {
    if (authorizerLambda.authMode === "access-token") {
      const sessionId = authorizerLambda.sessionId;
      const hostUserId = authorizerLambda.hostUserId;
      if (typeof sessionId !== "string" || typeof hostUserId !== "string" || !accessSessionRepository) {
        throw new ApplicationError("UNAUTHENTICATED", "La sesión del usuario no es válida.");
      }
      const session = await accessSessionRepository.get(sessionId);
      if (
        !session ||
        !session.active ||
        session.userId !== authorizedUserId.trim() ||
        session.hostUserId !== hostUserId.trim() ||
        session.expiresAtEpoch <= Math.floor(Date.now() / 1000)
      ) {
        throw new ApplicationError("UNAUTHENTICATED", "La sesión venció o fue revocada.");
      }
    }
    request.scAuthenticatedUserId = authorizedUserId.trim();
    if (authorizerLambda.authMode === "access-token") {
      request.scRateLimitUserId = authorizedUserId.trim();
    }
  } else if (authorizerLambda.authMode === "api-key") {
    const declaredUserId = request.headers["x-user-id"];
    request.scAuthenticatedUserId = typeof declaredUserId === "string" ? declaredUserId.trim() : undefined;
  }

  return true;
}
